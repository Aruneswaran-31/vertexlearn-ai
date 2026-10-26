import bcrypt from 'bcryptjs';
import { db, newId, nowIso } from './index.js';
import { ensureBadgeCatalog, awardBadge } from '../services/activity.js';
import { ingestLecture } from '../ai/retriever.js';
import { updateMasteryFromAttempt } from '../ai/engine.js';

const PASSWORD = 'Demo@12345';

type QuizQuestionSeed = {
  text: string;
  topic: string;
  explanation: string;
  options: [string, boolean][];
};

function daysAgo(days: number, hour = 9): string {
  const date = new Date(Date.now() - days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function insertUser(
  fullName: string,
  email: string,
  role: 'student' | 'instructor' | 'admin',
  headline: string,
  joinedDaysAgo = 60,
) {
  const id = newId();
  db.prepare(
    'INSERT INTO users (id, full_name, email, password_hash, headline, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(id, fullName, email, bcrypt.hashSync(PASSWORD, 10), headline, daysAgo(joinedDaysAgo), daysAgo(joinedDaysAgo));
  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number };
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleRow.id);
  db.prepare('INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date) VALUES (?, 0, 0, NULL)').run(id);
  return id;
}

function insertCourse(options: {
  instructorId: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  price: number;
  status: 'approved' | 'pending';
  thumbnail: string;
  outcomes: string[];
}) {
  const id = newId();
  db.prepare(
    `INSERT INTO courses (id, instructor_id, title, description, category, difficulty, thumbnail_url, price, status, outcomes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    options.instructorId,
    options.title,
    options.description,
    options.category,
    options.difficulty,
    options.thumbnail,
    options.price,
    options.status,
    JSON.stringify(options.outcomes),
    daysAgo(40),
  );
  return id;
}

function insertModule(courseId: string, title: string, order: number) {
  const id = newId();
  db.prepare('INSERT INTO modules (id, course_id, title, order_index) VALUES (?, ?, ?, ?)').run(
    id,
    courseId,
    title,
    order,
  );
  return id;
}

function insertLecture(moduleId: string, title: string, transcript: string, minutes: number, order: number) {
  const id = newId();
  db.prepare(
    `INSERT INTO lectures (id, module_id, title, video_url, transcript, duration_seconds, order_index, resource_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    moduleId,
    title,
    null,
    transcript,
    minutes * 60,
    order,
    JSON.stringify(['Lecture slides (PDF)', 'Worked examples (ZIP)']),
  );
  return id;
}

function insertQuiz(
  moduleId: string,
  title: string,
  questions: QuizQuestionSeed[],
  options: { aiGenerated?: boolean; lectureId?: string } = {},
) {
  const quizId = newId();
  db.prepare(
    'INSERT INTO quizzes (id, module_id, title, is_ai_generated, generated_from_lecture_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(quizId, moduleId, title, options.aiGenerated ? 1 : 0, options.lectureId ?? null, 'published', daysAgo(30));
  questions.forEach((question, index) => {
    const questionId = newId();
    db.prepare(
      `INSERT INTO quiz_questions (id, quiz_id, question_text, question_type, explanation, topic, order_index)
       VALUES (?, ?, ?, 'mcq', ?, ?, ?)`,
    ).run(questionId, quizId, question.text, question.explanation, question.topic, index);
    const insertOption = db.prepare(
      'INSERT INTO quiz_options (id, question_id, option_text, is_correct) VALUES (?, ?, ?, ?)',
    );
    for (const [text, correct] of question.options) {
      insertOption.run(newId(), questionId, text, correct ? 1 : 0);
    }
  });
  return quizId;
}

function enroll(userId: string, courseId: string, progress: number, days: number) {
  const id = newId();
  db.prepare(
    'INSERT INTO enrollments (id, user_id, course_id, enrolled_at, progress_percent) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, courseId, daysAgo(days), progress);
  return id;
}

function setProgress(
  enrollmentId: string,
  lectureId: string,
  completed: boolean,
  watched: number,
  days: number,
  hour = 18,
) {
  db.prepare(
    'INSERT INTO lecture_progress (id, enrollment_id, lecture_id, watched_seconds, completed, last_watched_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(newId(), enrollmentId, lectureId, watched, completed ? 1 : 0, daysAgo(days, hour));
}

function seedAttempt(userId: string, quizId: string, percent: number, days: number, weakTopics: string[] = []) {
  const questions = db
    .prepare('SELECT id, topic FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index')
    .all(quizId) as { id: string; topic: string }[];
  if (!questions.length) return null;

  const correctCount = Math.round((percent / 100) * questions.length);
  const ranked = [...questions].sort((a, b) => {
    const aWeak = weakTopics.includes(a.topic ?? '') ? 1 : 0;
    const bWeak = weakTopics.includes(b.topic ?? '') ? 1 : 0;
    return aWeak - bWeak;
  });
  const correctIds = new Set(ranked.slice(0, correctCount).map((question) => question.id));

  const attemptId = newId();
  const submitted = daysAgo(days, 20);
  const score = Math.round((correctIds.size / questions.length) * 1000) / 10;
  db.prepare(
    'INSERT INTO quiz_attempts (id, quiz_id, user_id, score, started_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(attemptId, quizId, userId, score, daysAgo(days, 19), submitted);

  for (const question of questions) {
    const options = db
      .prepare('SELECT id, is_correct FROM quiz_options WHERE question_id = ?')
      .all(question.id) as { id: string; is_correct: number }[];
    const correct = correctIds.has(question.id);
    const selected = correct
      ? options.filter((option) => option.is_correct).map((option) => option.id)
      : options.filter((option) => !option.is_correct).slice(0, 1).map((option) => option.id);
    db.prepare(
      'INSERT INTO quiz_answers (id, attempt_id, question_id, selected_option_ids, text_answer, is_correct, feedback) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    ).run(
      newId(),
      attemptId,
      question.id,
      JSON.stringify(selected),
      correct ? 1 : 0,
      correct ? 'Correct.' : 'Review the cited lecture segment for this topic.',
    );
  }
  return attemptId;
}

/* ------------------------------------------------------------------ */
/* Transcripts                                                        */
/* ------------------------------------------------------------------ */

const T = {
  bigO: `Big-O notation describes the upper bound on how the running time or memory usage of an algorithm grows as the input size grows. We write O of n to mean that doubling the input roughly doubles the work. Big-O deliberately ignores constants and lower order terms, because at large input sizes the growth rate dominates everything else. That is why an algorithm that takes two hundred milliseconds with a small constant but grows as n squared will eventually lose to one that grows as n log n, even if the second is slower for tiny inputs.

Some familiar growth rates, from fastest to slowest, are constant O of one, logarithmic O of log n, linear O of n, linearithmic O of n log n, quadratic O of n squared, and exponential O of two to the n. Accessing an element of an array by index is constant time. Binary search over a sorted array is logarithmic because each comparison halves the remaining search space. A single loop over n items is linear. A loop nested inside another loop is usually quadratic.

Big-O is not the only measure. Big-Theta describes a tight bound, and Big-Omega describes a lower bound. We also distinguish the worst case, the average case and the best case, because an algorithm can behave very differently on different inputs. Quicksort, for example, is O of n log n on average but O of n squared in the worst case.

Amortized analysis matters too. Appending to a dynamic array is O of n in the worst case when the array must be copied and doubled, but O of one amortized, because those expensive copies are rare and their cost spreads across many cheap appends. Space complexity follows the same notation: merge sort needs O of n extra memory, while insertion sort is in place. Always state which input parameter you are measuring, and whether you are counting time, comparisons or memory.`,

  structures: `An array stores elements in contiguous memory. Because each element has the same width, the address of the k-th element is the base address plus k times the element size, so indexing is constant time. Contiguous storage is also friendly to the CPU cache, which is why arrays often outperform linked structures in practice even when the theoretical complexity looks similar. The trade-off is that inserting or deleting in the middle requires shifting every later element, which is linear time. A dynamic array such as a Python list or a C++ vector also occasionally reallocates and copies its contents when it runs out of capacity.

A linked list stores each element in a node that also holds a pointer to the next node, and sometimes the previous one. Inserting or deleting a node is constant time once you already hold a reference to that node, because only the surrounding pointers change. Finding that node, however, is linear time, and the nodes are scattered in memory, so traversing a linked list produces many cache misses. Each node also carries the overhead of its pointers.

Use arrays when you need fast random access, tight iteration or cache-friendly performance. Use linked lists when you are frequently splicing elements into the middle and you already have a reference to the position, or when you are implementing a stack, a queue or a hash table's collision chains. A real-time example: an LRU cache is usually a hash map plus a doubly linked list, because the map gives constant time lookup and the linked list gives constant time reordering.`,

  mergeSort: `Merge sort is a divide-and-conquer sorting algorithm. It splits the input in half, recursively sorts each half, and then merges the two sorted halves into one sorted sequence. The base case is a slice with zero or one element, which is already sorted.

The merge step is the important part. You keep two pointers, one at the start of each half, compare the current elements, copy the smaller one into the output and advance that pointer. When one half is exhausted you copy the rest of the other half. Merging two sequences whose total length is n costs O of n time, because each element is copied exactly once.

The recursion tree has log base two of n levels, and every level performs O of n total merging work, so the total running time is O of n log n in the best, average and worst case. This predictable worst case is merge sort's main advantage over quicksort. Merge sort is stable if, when the two current elements are equal, you always take the element from the left half first. Stability matters when you sort records by one field after already sorting them by another.

The main drawback is space. A standard array implementation needs O of n auxiliary memory to hold the merged output. For linked lists merge sort can be implemented with only O of log n stack space. Merge sort is also the standard choice for external sorting, where the data is too large to fit in memory, because sequential merge passes work well with disk access.`,

  quicksort: `Quicksort picks a pivot element and partitions the array so that everything smaller than the pivot ends up to its left and everything larger ends up to its right. The pivot is then in its final position, and the algorithm recurses on the two partitions. Partitioning is done in place with two pointers, so quicksort needs only O of log n stack space on average and no auxiliary array.

The average running time is O of n log n, because a random pivot produces reasonably balanced partitions and the recursion tree has about log n levels. The worst case is O of n squared. That happens when the pivot is always the smallest or the largest element in its partition. If you always choose the first or last element as the pivot and the input is already sorted or reverse sorted, every partition produces one empty side and one side of n minus one elements. The recursion then has n levels instead of log n levels, and each level still costs O of n to partition, so the total work is O of n squared. Recursion depth also becomes O of n, which can overflow the call stack on large inputs.

The fixes are well known. Choose a random pivot, or use median-of-three, which takes the median of the first, middle and last elements so that sorted input produces a balanced split. Introsort goes further: it tracks recursion depth and switches to heapsort once the depth exceeds twice log n, guaranteeing O of n log n worst case. Three-way partitioning handles arrays with many duplicate keys efficiently, because equal elements are grouped in the middle and never recursed on.

Quicksort is not stable, so it cannot be used when equal-key order must be preserved. It is usually faster than merge sort in practice because partitioning scans memory sequentially and is cache friendly, and because it sorts in place.`,

  graphs: `A graph is a set of vertices connected by edges. Graphs can be directed or undirected, weighted or unweighted, and they model networks, maps, dependency graphs, social connections and state machines.

There are two standard representations. An adjacency list stores, for each vertex, a list of its neighbours. Its memory usage is O of V plus E, and iterating over a vertex's neighbours costs time proportional to its degree. An adjacency matrix stores a V by V table of booleans or weights. It uses O of V squared memory but answers the question "is there an edge between u and v" in constant time.

For sparse graphs, where the number of edges is much smaller than V squared, the adjacency list is almost always the right choice. For dense graphs, or when the algorithm needs many constant-time edge lookups, a matrix can win. Weighted graphs store weights alongside neighbours in the list, or in the matrix cells. Undirected graphs are typically stored with each edge appearing twice, once in each endpoint's list.

A practical example: a road network has millions of intersections but only a few roads per intersection, so it is sparse and adjacency lists are appropriate. A small tournament schedule between sixteen teams is dense, and a matrix is simpler. When you build a graph from real data, always decide up front whether self-loops and parallel edges are allowed, because that choice changes both the representation and the traversal logic.`,

  traversal: `Breadth-first search and depth-first search are the two fundamental graph traversals, and both run in O of V plus E time when the graph is stored as an adjacency list.

Breadth-first search uses a queue. It starts at a source vertex, marks it visited, enqueues it, and then repeatedly dequeues a vertex and enqueues all of its unvisited neighbours. Because it explores vertices in order of distance from the source, BFS finds the shortest path in an unweighted graph. The distance array is filled in as you go, and the visited set prevents both infinite loops and duplicate work. BFS memory is proportional to the size of the frontier, which can be large on wide graphs.

Depth-first search uses a stack, either explicitly or through recursion. It follows one path as far as possible before backtracking. DFS is the basis for cycle detection, topological sorting of a directed acyclic graph, finding connected components and strongly connected components. Its recursion depth can reach V, so an iterative version is safer for large graphs. A visited set is still required.

One subtlety: a visited set alone is not enough for cycle detection in directed graphs. You also need to distinguish vertices on the current recursion stack. And when a graph is disconnected, you must loop over every vertex and start a new traversal from any unvisited one, otherwise you only cover the component containing your starting point.`,

  mlIntro: `Machine learning is the practice of fitting a model to data so that it generalises to examples it has not seen. The core distinction is between training, where the model learns parameters from labelled or unlabelled examples, and inference, where the trained model produces predictions for new inputs.

In supervised learning, every training example has a label. If the label is a category, the task is classification; if it is a continuous number, the task is regression. In unsupervised learning there are no labels, and the goal is to discover structure, for example clusters or lower-dimensional representations. Reinforcement learning learns a policy by interacting with an environment and receiving rewards.

The features are the inputs you choose to represent each example, and feature quality often matters more than model choice. A model that is too simple cannot capture the pattern, which is underfitting. A model that is too flexible memorises the training set, which is overfitting. The test of generalisation is performance on held-out data, not on the training set.

Always ask what decision the prediction will inform, because that determines which metric matters and how much error is acceptable. A model that predicts whether a transaction is fraudulent should be evaluated on its ability to catch fraud without drowning reviewers in false positives, not on raw accuracy.`,

  biasVariance: `Bias and variance describe the two ways a model can fail. Bias is error from overly simplistic assumptions; a high-bias model underfits, missing the pattern in both training and validation data. Variance is error from sensitivity to the particular training sample; a high-variance model overfits, performing well on training data and poorly on validation data.

The bias-variance trade-off says that increasing model complexity usually reduces bias and increases variance. The best model minimises total expected error, which is bias squared plus variance plus irreducible noise. There is no way to eliminate the noise term, so chasing zero training error is always a mistake.

Practical diagnosis: if training and validation error are both high and close together, the model is underfitting and you should add capacity, better features or train longer. If training error is low but validation error is much higher, the model is overfitting and you should add regularisation, simplify the model, gather more data, or use early stopping.

Regularisation constrains model complexity. L2 regularisation shrinks weights smoothly, while L1 encourages sparse weights and can act as feature selection. Ensembling reduces variance by averaging many models. Learning curves, which plot training and validation error against training set size, tell you whether more data would help: if the curves converge at a high error, the model has a bias problem and more data will not fix it.`,

  evaluation: `Model evaluation estimates how a model will perform on unseen data. The simplest approach is a holdout split: train on one portion and evaluate on another. If you tune hyperparameters on the same test set you evaluate on, you leak information and your estimate becomes optimistic. Use three splits instead: training, validation for tuning, and a test set touched only once at the end.

K-fold cross-validation is more data-efficient. Split the data into k folds, train k times, each time holding out a different fold, and average the scores. Five or ten folds are typical. Stratified k-fold preserves the class proportions in each fold, which matters for imbalanced classification.

Data leakage is the most common evaluation bug. It happens when information from the target or from the future sneaks into the features. Scaling before splitting, using future rows to fill missing values, or including an identifier that correlates with the label all inflate scores. Always fit preprocessing on the training fold only.

For time series, never use random splits. Train on the past and validate on the future, using a rolling or expanding window. Otherwise the model sees the future during training and the reported error is meaningless. Finally, report uncertainty: a single accuracy number without a confidence interval hides how much the estimate could move with a different sample.`,

  metrics: `A confusion matrix lays out true positives, false positives, true negatives and false negatives. From it, precision is the fraction of predicted positives that are actually positive, and recall is the fraction of actual positives that the model found. Accuracy alone is misleading on imbalanced data: predicting the majority class every time can score ninety-nine percent accuracy while catching none of the cases you care about.

The F1 score is the harmonic mean of precision and recall. It weights both equally and is useful when you need a single number for imbalanced classification. If false positives and false negatives have different costs, choose a metric that reflects that trade-off instead of defaulting to F1. In medical screening, recall usually matters more because missing a disease is worse than a false alarm. In spam filtering, precision matters more because flagging legitimate mail is costly.

Precision and recall trade off through the decision threshold. Lowering the threshold predicts positive more often, which raises recall and lowers precision. A precision-recall curve plots this trade-off across thresholds, and average precision summarises it. The ROC curve plots true positive rate against false positive rate; its area, AUC, is threshold independent and useful for ranking, but it can look optimistic when classes are very imbalanced.

Report the metric that matches the decision, state the threshold you used, and always compare against a trivial baseline such as predicting the majority class.`,

  reactRender: `React components are functions that return a description of the user interface. When state or props change, React calls the component again and produces a new description, then reconciles it with the previous one to compute the minimal set of DOM updates. The virtual DOM is just that in-memory description; it is not automatically faster than direct DOM manipulation, but it lets you write declarative code while React handles the updates.

A component re-renders when its own state changes, when its parent re-renders, or when a context value it consumes changes. Re-rendering is not the same as updating the DOM: React compares the new output with the old and only touches the DOM where something actually changed.

Keys matter in lists. React uses keys to match elements between renders. If you use array indices as keys and reorder the list, React can attach state and DOM nodes to the wrong items. Use a stable identifier from your data.

State updates are batched. Calling a setter several times in one event handler does not trigger several renders. When the next value depends on the previous one, use the functional form of the setter, because the value captured in the closure may be stale.

Memoisation is an optimisation, not a correctness tool. Wrapping a component in memo prevents re-rendering when props are shallow-equal, but it only helps if the component is genuinely expensive and its props are stable. Measure before optimising.`,

  reactState: `Props are read-only inputs passed from a parent to a child. State is data owned by a component that can change over time and trigger a re-render. The rule of one-way data flow means data moves down through props and events move up through callbacks. A child never mutates its parent's data directly; it calls a function the parent provided.

When two components need the same data, lift the state up to their closest common ancestor and pass it down. This keeps a single source of truth. For data needed across many distant components, context or a dedicated state library is appropriate, but context is not a performance silver bullet: every consumer re-renders when the context value changes.

Always update state immutably. Instead of pushing into an array, create a new array with the spread operator or map. Instead of mutating an object, spread it and override the changed field. React relies on reference equality to decide whether something changed.

Controlled components take their value from state and report changes through onChange, which makes validation and conditional rendering straightforward. Uncontrolled components keep their value in the DOM and are read through a ref, which is simpler for large forms or integration with non-React code.

Finally, derive values during render instead of storing them in state. If a value can be computed from existing props or state, computing it avoids a whole class of bugs where two pieces of state drift apart.`,

  reactEffects: `Effects let a component synchronise with something outside React, such as a network request, a subscription, a timer or the browser's document title. They run after the render is committed to the DOM, so they should not be used to compute values that could be derived during render.

The dependency array controls when an effect re-runs. An empty array means the effect runs once after the first render and its cleanup runs when the component unmounts. Omitting the array makes it run after every render, which is rarely what you want. Every reactive value used inside the effect belongs in the dependency array; the linter is usually right about this.

Cleanup is essential for subscriptions, intervals and in-flight requests. Return a function from the effect that clears the timer or aborts the request. Without it, a slow response from a previous render can overwrite fresh data, and timers keep firing after the component is gone.

Avoid setting state unconditionally inside an effect that depends on that state, because that creates an infinite loop. If you are fetching data, consider a data-fetching library that handles caching, retries and cancellation. In React eighteen and later, development mode intentionally runs effects twice to surface missing cleanup, so code that looks duplicated in development may be fine once cleanup is correct.`,

  distributed: `Consistency models describe what guarantees a distributed system gives about reads and writes. Strong consistency means every read sees the latest completed write. Eventual consistency means replicas converge over time, but a read may return stale data in the meantime. Between them sit models such as read-your-writes, monotonic reads and causal consistency, each offering a different balance of latency and correctness.

The CAP theorem says that during a network partition a system must choose between consistency and availability. That choice is not global: many systems offer per-operation tunable consistency. The PACELC extension adds that even without a partition, you trade latency against consistency.

Replication improves availability and read throughput but introduces the problem of stale reads. Quorum systems require a majority of replicas to acknowledge a write and a majority to agree on a read, so the two sets overlap and the read sees the latest write. Consensus protocols such as Raft and Paxos provide linearisable operations at the cost of additional round trips.

Idempotency is the practical tool for unreliable networks. If a client retries a request, the server must not apply the effect twice. Idempotency keys, deduplication tables and conditional writes all help. Exactly-once delivery is a myth at the network level; what you can build is at-least-once delivery plus idempotent processing.`,
};

/* ------------------------------------------------------------------ */
/* Seed                                                               */
/* ------------------------------------------------------------------ */

export function seedIfEmpty(): { users: number; courses: number; chunks: number } {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (existing.count > 0) return { users: 0, courses: 0, chunks: 0 };

  ensureBadgeCatalog();

  db.transaction(() => {
    const tableOrder = [
      'ai_chat_messages', 'ai_chat_sessions', 'study_plans', 'flashcards', 'document_chunks',
      'topic_mastery', 'recommendations', 'quiz_answers', 'quiz_attempts', 'quiz_options',
      'quiz_questions', 'quizzes', 'assignment_submissions', 'assignments', 'certificates',
      'user_badges', 'streaks', 'notifications', 'announcements', 'discussion_posts',
      'discussion_threads', 'course_approvals', 'audit_logs', 'payments', 'refresh_tokens',
      'notes', 'bookmarks', 'lecture_progress', 'enrollments', 'lectures', 'modules',
      'courses', 'user_roles', 'users',
    ];
    for (const table of tableOrder) db.prepare(`DELETE FROM ${table}`).run();

    for (const role of ['student', 'instructor', 'admin']) {
      db.prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)').run(role);
    }

    const admin = insertUser('Meera Iyer', 'admin@vertexlearn.ai', 'admin', 'Platform administrator');
    const rohit = insertUser('Rohit Verma', 'instructor@vertexlearn.ai', 'instructor', 'DSA instructor · ex-Amazon SDE', 48);
    const kavya = insertUser('Dr. Kavya Menon', 'kavya@vertexlearn.ai', 'instructor', 'ML researcher and educator', 40);
    const arjun = insertUser('Arjun Nair', 'arjun@vertexlearn.ai', 'instructor', 'Frontend engineer at a product studio', 33);
    const ananya = insertUser('Ananya Sharma', 'student@vertexlearn.ai', 'student', 'Final-year B.Tech · preparing for placements', 45);
    const vikram = insertUser('Vikram Rao', 'vikram@vertexlearn.ai', 'student', 'Backend developer, upskilling', 26);
    const priya = insertUser('Priya Nair', 'priya@vertexlearn.ai', 'student', 'Data analyst learning ML', 24);
    const rahul = insertUser('Rahul Das', 'rahul@vertexlearn.ai', 'student', 'Second-year student', 4);

    const dsa = insertCourse({
      instructorId: rohit,
      title: 'Data Structures & Algorithms in Practice',
      description:
        'Build interview-ready intuition for complexity, sorting, graphs and problem solving. Every lecture is paired with a graded quiz and an AI tutor that answers strictly from this course material.',
      category: 'Computer Science',
      difficulty: 'intermediate',
      price: 0,
      status: 'approved',
      thumbnail: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1200&q=80',
      outcomes: [
        'Analyse algorithms with Big-O, Big-Theta and amortised reasoning',
        'Choose the right data structure for a workload',
        'Implement merge sort and quicksort, and explain their trade-offs',
        'Traverse graphs with BFS and DFS and apply them to real problems',
      ],
    });

    const dsaM1 = insertModule(dsa, 'Complexity & Core Structures', 0);
    const dsaM2 = insertModule(dsa, 'Sorting Algorithms', 1);
    const dsaM3 = insertModule(dsa, 'Graphs & Traversal', 2);

    const dsaL1 = insertLecture(dsaM1, 'Big-O Notation and Why It Matters', T.bigO, 14, 0);
    const dsaL2 = insertLecture(dsaM1, 'Arrays, Linked Lists and Memory Layout', T.structures, 16, 1);
    const dsaL3 = insertLecture(dsaM2, 'Merge Sort: Divide and Conquer', T.mergeSort, 18, 0);
    const dsaL4 = insertLecture(dsaM2, 'Quicksort and Pivot Selection', T.quicksort, 20, 1);
    const dsaL5 = insertLecture(dsaM3, 'Graph Representations', T.graphs, 15, 0);
    const dsaL6 = insertLecture(dsaM3, 'BFS and DFS', T.traversal, 17, 1);

    const dsaQ1 = insertQuiz(dsaM1, 'Checkpoint: Complexity & Structures', [
      {
        text: 'What does Big-O notation describe?',
        topic: 'Big-O',
        explanation:
          'Big-O describes the upper bound on how running time or memory grows with input size, ignoring constants.',
        options: [
          ['The upper bound on how runtime grows with input size', true],
          ['The exact number of milliseconds an algorithm takes', false],
          ['The best-case performance only', false],
          ['The amount of memory a program uses at startup', false],
        ],
      },
      {
        text: 'Accessing the k-th element of an array is which complexity?',
        topic: 'Arrays',
        explanation: 'Contiguous storage allows the address to be computed directly, so indexing is O(1).',
        options: [
          ['O(1)', true],
          ['O(log n)', false],
          ['O(n)', false],
          ['O(n log n)', false],
        ],
      },
      {
        text: 'When is inserting into a linked list O(1)?',
        topic: 'Linked Lists',
        explanation:
          'Insertion is constant time only when you already hold a reference to the node you are inserting after.',
        options: [
          ['When you already hold a reference to the insertion node', true],
          ['When the list is sorted', false],
          ['Always, regardless of position', false],
          ['Only when inserting at the tail and no tail pointer exists', false],
        ],
      },
      {
        text: 'Which growth rate dominates as n becomes very large?',
        topic: 'Complexity Analysis',
        explanation: 'Quadratic growth outpaces n log n, n and log n for large inputs.',
        options: [
          ['O(n²)', true],
          ['O(n log n)', false],
          ['O(n)', false],
          ['O(log n)', false],
        ],
      },
    ]);

    const dsaQ2 = insertQuiz(dsaM2, 'Checkpoint: Sorting Algorithms', [
      {
        text: 'What is the worst-case time complexity of merge sort?',
        topic: 'Merge Sort',
        explanation: 'Merge sort splits and merges in a balanced recursion tree, giving O(n log n) in every case.',
        options: [
          ['O(n log n)', true],
          ['O(n²)', false],
          ['O(n)', false],
          ['O(log n)', false],
        ],
      },
      {
        text: 'Why does quicksort degrade to O(n²) when the first element is the pivot and the input is already sorted?',
        topic: 'Quicksort',
        explanation:
          'The smallest element is chosen every time, producing one empty partition and one of size n−1, so there are n levels each costing O(n).',
        options: [
          ['Every partition is maximally unbalanced, producing n levels of recursion', true],
          ['The pivot comparison itself becomes quadratic', false],
          ['Sorted input disables the base case', false],
          ['Merge sort must be called as a fallback', false],
        ],
      },
      {
        text: 'Which technique guarantees O(n log n) worst-case performance for quicksort?',
        topic: 'Quicksort',
        explanation: 'Introsort switches to heapsort when recursion depth exceeds twice log n, guaranteeing the bound.',
        options: [
          ['Switching to heapsort past a depth limit (introsort)', true],
          ['Always choosing the last element as the pivot', false],
          ['Removing duplicate elements before sorting', false],
          ['Using recursion instead of an explicit stack', false],
        ],
      },
      {
        text: 'Which sorting algorithm is stable by construction when merge takes the left element on ties?',
        topic: 'Merge Sort',
        explanation: 'Taking from the left half on ties preserves the original relative order, making merge sort stable.',
        options: [
          ['Merge sort', true],
          ['Quicksort with Lomuto partitioning', false],
          ['Heapsort', false],
          ['Selection sort', false],
        ],
      },
      {
        text: 'What is the average-case complexity of quicksort with a random pivot?',
        topic: 'Quicksort',
        explanation: 'Random pivots produce balanced partitions on average, giving O(n log n).',
        options: [
          ['O(n log n)', true],
          ['O(n²)', false],
          ['O(n)', false],
          ['O(log n)', false],
        ],
      },
    ]);

    const dsaQ3 = insertQuiz(dsaM3, 'Checkpoint: Graphs', [
      {
        text: 'Which representation uses O(V + E) memory for a sparse graph?',
        topic: 'Graphs',
        explanation: 'Adjacency lists store only existing edges, using memory proportional to vertices plus edges.',
        options: [
          ['Adjacency list', true],
          ['Adjacency matrix', false],
          ['Incidence matrix', false],
          ['Edge-weight table of size V²', false],
        ],
      },
      {
        text: 'Which traversal finds the shortest path in an unweighted graph?',
        topic: 'BFS',
        explanation: 'BFS explores by distance from the source, so the first time it reaches a vertex is the shortest path.',
        options: [
          ['Breadth-first search', true],
          ['Depth-first search', false],
          ['Topological sort', false],
          ['Dijkstra without weights', false],
        ],
      },
      {
        text: 'Why must a DFS for cycle detection track the current recursion stack?',
        topic: 'DFS',
        explanation:
          'A visited set alone cannot distinguish a back edge from a cross edge to an already finished vertex.',
        options: [
          ['A visited set alone cannot detect back edges in a directed graph', true],
          ['DFS cannot visit a vertex twice under any circumstance', false],
          ['The stack is only needed for undirected graphs', false],
          ['Cycle detection never requires a visited set', false],
        ],
      },
    ]);

    const dsaA1 = newId();
    db.prepare(
      'INSERT INTO assignments (id, course_id, title, instructions, rubric, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      dsaA1,
      dsa,
      'Benchmark three sorting algorithms',
      'Implement merge sort, quicksort with median-of-three, and insertion sort. Benchmark them on sorted, reverse-sorted and random arrays of 1k, 10k and 100k integers. Submit a short report with your timings and explain which curves match the expected complexity, plus one example where the faster asymptotic algorithm loses on small inputs.',
      JSON.stringify([
        { criterion: 'Correct implementations with edge-case handling', points: 40 },
        { criterion: 'Methodology and fair benchmarking', points: 30 },
        { criterion: 'Analysis connecting results to Big-O', points: 30 },
      ]),
      new Date(Date.now() + 10 * 86_400_000).toISOString(),
      daysAgo(12),
    );

    /* ------------------------- ML course ------------------------- */
    const ml = insertCourse({
      instructorId: kavya,
      title: 'Machine Learning Foundations',
      description:
        'A rigorous but friendly introduction to how models learn, why they fail and how to evaluate them properly. Includes auto-graded checkpoints, AI flashcards and a personalised study plan.',
      category: 'Machine Learning',
      difficulty: 'beginner',
      price: 49,
      status: 'approved',
      thumbnail: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=1200&q=80',
      outcomes: [
        'Distinguish supervised, unsupervised and reinforcement learning',
        'Diagnose underfitting and overfitting with learning curves',
        'Design leak-free train/validation/test workflows',
        'Choose precision, recall or F1 based on the cost of errors',
      ],
    });

    const mlM1 = insertModule(ml, 'How Models Learn', 0);
    const mlM2 = insertModule(ml, 'Evaluating a Model', 1);

    const mlL1 = insertLecture(mlM1, 'What Machine Learning Actually Is', T.mlIntro, 15, 0);
    const mlL2 = insertLecture(mlM1, 'Bias, Variance and the Trade-off', T.biasVariance, 17, 1);
    const mlL3 = insertLecture(mlM2, 'Train/Test Splits and Cross-Validation', T.evaluation, 16, 0);
    const mlL4 = insertLecture(mlM2, 'Precision, Recall and F1', T.metrics, 14, 1);

    const mlQ1 = insertQuiz(mlM1, 'Checkpoint: Learning Fundamentals', [
      {
        text: 'A model performs well on training data but poorly on validation data. What is happening?',
        topic: 'Bias & Variance',
        explanation: 'Low training error with high validation error is the signature of high variance (overfitting).',
        options: [
          ['Overfitting — the model has high variance', true],
          ['Underfitting — the model has high bias', false],
          ['The validation set is always wrong', false],
          ['The model has too few parameters', false],
        ],
      },
      {
        text: 'Which change most directly reduces high bias?',
        topic: 'Bias & Variance',
        explanation: 'Underfitting is addressed by increasing model capacity or improving features.',
        options: [
          ['Increasing model capacity or adding better features', true],
          ['Adding more L2 regularisation', false],
          ['Reducing training time', false],
          ['Decreasing the number of features', false],
        ],
      },
      {
        text: 'Which split is used for tuning hyperparameters?',
        topic: 'Evaluation',
        explanation: 'The validation set (or cross-validation folds) is used for tuning; the test set is touched once.',
        options: [
          ['The validation set', true],
          ['The test set', false],
          ['The training set only', false],
          ['No split — tune on all data', false],
        ],
      },
      {
        text: 'Why is accuracy a poor metric for a 99:1 imbalanced dataset?',
        topic: 'Metrics',
        explanation: 'Predicting the majority class always scores 99% accuracy while catching none of the minority class.',
        options: [
          ['Predicting the majority class alone already scores 99% accuracy', true],
          ['Accuracy cannot be computed for two classes', false],
          ['Accuracy ignores the training set', false],
          ['Accuracy is always lower than recall', false],
        ],
      },
    ]);

    const mlA1 = newId();
    db.prepare(
      'INSERT INTO assignments (id, course_id, title, instructions, rubric, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      mlA1,
      ml,
      'Build a leak-free evaluation pipeline',
      'Take the provided customer-churn dataset. Split it into train, validation and test sets. Fit all preprocessing on the training fold only, tune one hyperparameter with 5-fold cross-validation, and report precision, recall and F1 on the test set with a short explanation of which metric you would optimise for the business and why.',
      JSON.stringify([
        { criterion: 'Correct, leak-free splitting and preprocessing', points: 40 },
        { criterion: 'Cross-validation and tuning executed properly', points: 30 },
        { criterion: 'Metric choice justified against the business cost', points: 30 },
      ]),
      new Date(Date.now() + 6 * 86_400_000).toISOString(),
      daysAgo(9),
    );

    /* ------------------------ React course ------------------------ */
    const react = insertCourse({
      instructorId: arjun,
      title: 'Modern Web Development with React',
      description:
        'Understand the React rendering model, state ownership and effects, then apply them to build interfaces that stay predictable as they grow.',
      category: 'Web Development',
      difficulty: 'beginner',
      price: 39,
      status: 'approved',
      thumbnail: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=1200&q=80',
      outcomes: [
        'Explain reconciliation and the rules for keys',
        'Choose between props, state, lifted state and context',
        'Write effects with correct dependencies and cleanup',
      ],
    });
    const reactM1 = insertModule(react, 'Rendering & State', 0);
    const reactL1 = insertLecture(reactM1, 'The React Rendering Model', T.reactRender, 15, 0);
    const reactL2 = insertLecture(reactM1, 'State, Props and One-Way Data Flow', T.reactState, 16, 1);
    const reactL3 = insertLecture(reactM1, 'Effects and Side Effects', T.reactEffects, 14, 2);
    const reactQ1 = insertQuiz(reactM1, 'Checkpoint: React Fundamentals', [
      {
        text: 'Which statement about re-rendering is correct?',
        topic: 'Rendering',
        explanation: 'Re-rendering means React recomputes the component output; only changed DOM nodes are updated.',
        options: [
          ['A component re-renders when its state or props change, but the DOM only updates where output differs', true],
          ['Every re-render rewrites the entire DOM', false],
          ['Components re-render only on a full page reload', false],
          ['Keys control whether a component re-renders', false],
        ],
      },
      {
        text: 'What is the recommended way to update state based on its previous value?',
        topic: 'State',
        explanation: 'The functional updater avoids stale closures when the next value depends on the previous one.',
        options: [
          ['Use the functional form of the setter', true],
          ['Read the variable from the closure and add one', false],
          ['Mutate the state object directly', false],
          ['Store the value in a ref and force a reload', false],
        ],
      },
      {
        text: 'When does the cleanup function of an effect run?',
        topic: 'Effects',
        explanation: 'Cleanup runs before the effect re-runs and again when the component unmounts.',
        options: [
          ['Before the effect runs again, and on unmount', true],
          ['Only when the browser tab closes', false],
          ['Immediately after every render, before the effect', false],
          ['Only if the effect throws an error', false],
        ],
      },
    ]);

    /* ---------------------- Pending course ---------------------- */
    const pending = insertCourse({
      instructorId: rohit,
      title: 'Distributed Systems for Interviews',
      description:
        'A deep dive into consistency models, replication, consensus and failure handling, built around the questions senior backend interviews actually ask.',
      category: 'Computer Science',
      difficulty: 'advanced',
      price: 79,
      status: 'pending',
      thumbnail: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
      outcomes: ['Reason about CAP and PACELC', 'Design replicated systems with quorums', 'Make retries safe with idempotency'],
    });
    const pendingM1 = insertModule(pending, 'Consistency & Replication', 0);
    insertLecture(pendingM1, 'Consistency Models Explained', T.distributed, 21, 0);

    /* ----------------------- Enrollments ----------------------- */
    const ananyaDsa = enroll(ananya, dsa, 50, 24);
    const ananyaMl = enroll(ananya, ml, 100, 38);
    const vikramDsa = enroll(vikram, dsa, 33.33, 20);
    const vikramReact = enroll(vikram, react, 66.67, 15);
    const priyaDsa = enroll(priya, dsa, 16.67, 18);
    const priyaMl = enroll(priya, ml, 50, 22);
    enroll(rahul, dsa, 0, 21);

    setProgress(ananyaDsa, dsaL1, true, 840, 6);
    setProgress(ananyaDsa, dsaL2, true, 960, 4);
    setProgress(ananyaDsa, dsaL3, true, 1080, 1);
    setProgress(ananyaDsa, dsaL4, false, 420, 0, 8);

    setProgress(ananyaMl, mlL1, true, 900, 30);
    setProgress(ananyaMl, mlL2, true, 1020, 24);
    setProgress(ananyaMl, mlL3, true, 960, 16);
    setProgress(ananyaMl, mlL4, true, 840, 8);

    setProgress(vikramDsa, dsaL1, true, 840, 10);
    setProgress(vikramDsa, dsaL2, true, 620, 3);
    setProgress(vikramReact, reactL1, true, 900, 5);
    setProgress(vikramReact, reactL2, true, 640, 2);

    setProgress(priyaDsa, dsaL1, true, 300, 12);
    setProgress(priyaMl, mlL1, true, 900, 9);
    setProgress(priyaMl, mlL2, true, 700, 3);

    /* ------------------------ Attempts ------------------------- */
    seedAttempt(ananya, dsaQ1, 100, 5);
    seedAttempt(ananya, dsaQ2, 60, 2, ['Quicksort']);
    seedAttempt(ananya, mlQ1, 100, 7);
    seedAttempt(vikram, dsaQ1, 50, 4);
    seedAttempt(vikram, reactQ1, 66, 3);
    seedAttempt(priya, dsaQ1, 75, 3);

    const allAttempts = db.prepare('SELECT id FROM quiz_attempts').all() as { id: string }[];
    for (const attempt of allAttempts) updateMasteryFromAttempt(attempt.id);

    /* --------------------- Assignments work -------------------- */
    db.prepare(
      'INSERT INTO assignment_submissions (id, assignment_id, user_id, file_url, content, submitted_at, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      newId(),
      dsaA1,
      ananya,
      'https://github.com/example/sorting-benchmark',
      'Benchmarks and analysis attached.',
      daysAgo(2),
      null,
      null,
    );
    db.prepare(
      'INSERT INTO assignment_submissions (id, assignment_id, user_id, file_url, content, submitted_at, grade, feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      newId(),
      mlA1,
      priya,
      'https://example.com/churn-pipeline.ipynb',
      'Leak-free pipeline with 5-fold CV.',
      daysAgo(3),
      82,
      'Strong pipeline. Explain why you chose recall over precision for the business case next time.',
    );

    /* -------------------------- Social ------------------------- */
    db.prepare(
      'INSERT INTO announcements (id, course_id, posted_by, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      newId(),
      dsa,
      rohit,
      'Live doubt-clearing session this Friday at 7 PM IST. Bring your quicksort benchmarking results — we will compare worst-case curves together.',
      daysAgo(2),
    );
    db.prepare(
      'INSERT INTO announcements (id, course_id, posted_by, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      newId(),
      ml,
      kavya,
      'Assignment 1 grades are out. If you lost points on data leakage, re-watch the train/test lecture before the next module.',
      daysAgo(1),
    );

    const thread1 = newId();
    db.prepare(
      'INSERT INTO discussion_threads (id, course_id, created_by, title, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(thread1, dsa, ananya, 'Why does quicksort hit O(n²) on sorted input?', daysAgo(3));
    db.prepare(
      'INSERT INTO discussion_posts (id, thread_id, user_id, content, is_flagged, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(
      newId(),
      thread1,
      ananya,
      'I understand that picking the first element as pivot is bad, but I still do not see why sorted input specifically triggers the worst case. Can someone explain the recursion tree?',
      daysAgo(3),
    );
    db.prepare(
      'INSERT INTO discussion_posts (id, thread_id, user_id, content, is_flagged, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(
      newId(),
      thread1,
      rohit,
      'With sorted input the first element is always the minimum, so one partition is empty and the other has n−1 elements. That gives n levels of recursion instead of log n, and each level still costs O(n) to partition. Try median-of-three or a random pivot and the depth drops back to log n.',
      daysAgo(2),
    );

    const spamThread = newId();
    db.prepare(
      'INSERT INTO discussion_threads (id, course_id, created_by, title, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(spamThread, dsa, rahul, 'Free notes and exam leaks', daysAgo(1));
    db.prepare(
      'INSERT INTO discussion_posts (id, thread_id, user_id, content, is_flagged, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(
      newId(),
      spamThread,
      rahul,
      'Message me on Telegram for leaked question papers and guaranteed grades. Limited slots!',
      daysAgo(1),
    );

    /* ---------------------- Certificate ----------------------- */
    const certId = newId('cert');
    db.prepare(
      'INSERT INTO certificates (id, user_id, course_id, certificate_url, issued_at) VALUES (?, ?, ?, ?, ?)',
    ).run(certId, ananya, ml, `/api/v1/certificates/${certId}/download`, daysAgo(8));
    db.prepare('UPDATE enrollments SET completed_at = ? WHERE id = ?').run(daysAgo(8), ananyaMl);

    /* ----------------------- Payments ------------------------- */
    const insertPayment = db.prepare(
      'INSERT INTO payments (id, user_id, course_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertPayment.run(newId(), ananya, ml, 49, 'success', daysAgo(38));
    insertPayment.run(newId(), priya, ml, 49, 'success', daysAgo(22));
    insertPayment.run(newId(), vikram, react, 39, 'success', daysAgo(15));

    /* ------------------- AI conversation --------------------- */
    const chatId = newId();
    db.prepare(
      'INSERT INTO ai_chat_sessions (id, user_id, course_id, mode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(chatId, ananya, dsa, 'intermediate', daysAgo(2));
    db.prepare(
      'INSERT INTO ai_chat_messages (id, session_id, sender, content, source_lecture_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      newId(),
      chatId,
      'user',
      'Why does quicksort degrade to O(n^2) on sorted input?',
      null,
      daysAgo(2, 19),
    );
    db.prepare(
      'INSERT INTO ai_chat_messages (id, session_id, sender, content, source_lecture_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      newId(),
      chatId,
      'ai',
      '**Answer:** If you always choose the first or last element as the pivot and the input is already sorted, every partition produces one empty side and one side of n−1 elements, so the recursion has n levels instead of log n — and each level still costs O(n) to partition, giving O(n²). [1]\n\n**Key points from the course material:**\n- Choose a random pivot or median-of-three to make sorted input produce a balanced split. [1]\n- Introsort switches to heapsort past a depth limit, guaranteeing O(n log n) worst case. [1]\n- Quicksort is not stable, so it cannot preserve equal-key order. [1]\n\n**In short:** the worst case is about partition balance, not about the input being "bad" — sorted data just happens to be the worst case for a naive pivot rule.',
      JSON.stringify([dsaL4]),
      daysAgo(2, 19),
    );

    /* -------------------- Notifications ---------------------- */
    const insertNotification = db.prepare(
      'INSERT INTO notifications (id, user_id, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insertNotification.run(
      newId(),
      ananya,
      'New quiz: Checkpoint: Sorting Algorithms',
      'A new quiz is available in Data Structures & Algorithms in Practice.',
      '/quizzes/' + dsaQ2,
      0,
      daysAgo(3),
    );
    insertNotification.run(
      newId(),
      ananya,
      'Graded: Build a leak-free evaluation pipeline',
      'You scored 82/100. Feedback: explain why you chose recall over precision next time.',
      '/assignments/' + mlA1,
      0,
      daysAgo(3),
    );
    insertNotification.run(
      newId(),
      rohit,
      'New submission: Benchmark three sorting algorithms',
      'Ananya Sharma submitted.',
      '/instructor',
      0,
      daysAgo(2),
    );
    insertNotification.run(
      newId(),
      admin,
      'Course awaiting approval',
      'Rohit Verma submitted "Distributed Systems for Interviews".',
      '/admin/approvals',
      0,
      daysAgo(5),
    );

    /* ------------------------ Streaks ------------------------- */
    db.prepare('UPDATE streaks SET current_streak = 6, longest_streak = 9, last_active_date = date(\'now\') WHERE user_id = ?').run(ananya);
    db.prepare('UPDATE streaks SET current_streak = 2, longest_streak = 5, last_active_date = date(\'now\', \'-1 day\') WHERE user_id = ?').run(vikram);
    db.prepare('UPDATE streaks SET current_streak = 1, longest_streak = 4, last_active_date = date(\'now\', \'-3 day\') WHERE user_id = ?').run(priya);
    db.prepare('UPDATE streaks SET current_streak = 12, longest_streak = 12, last_active_date = date(\'now\') WHERE user_id = ?').run(rohit);

    db.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), admin, 'user.role', 'user', kavya, JSON.stringify({ role: 'instructor' }), daysAgo(20));
    db.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), admin, 'course.approved', 'course', dsa, JSON.stringify({}), daysAgo(35));

    /* ---------------------- Recommendations ------------------ */
    db.prepare(
      'INSERT INTO recommendations (id, user_id, recommended_course_id, reason, score, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newId(), ananya, react, 'Broaden beyond algorithms with frontend engineering', 72, nowIso());

    return {
      ananya,
      vikram,
      priya,
      rahul,
      rohit,
      kavya,
      arjun,
      admin,
      dsa,
      ml,
      react,
      pending,
      lectures: [dsaL1, dsaL2, dsaL3, dsaL4, dsaL5, dsaL6, mlL1, mlL2, mlL3, mlL4, reactL1, reactL2, reactL3],
      quizzes: [dsaQ1, dsaQ2, dsaQ3],
    };
  })();

  // Award badges after the transaction so notification inserts are consistent.
  const ananya = db.prepare("SELECT id FROM users WHERE email = 'student@vertexlearn.ai'").get() as { id: string };
  for (const slug of ['first_steps', 'perfect_quiz', 'course_complete'] as const) {
    awardBadge(ananya.id, slug);
  }

  const lectures = db.prepare('SELECT id FROM lectures').all() as { id: string }[];
  let chunks = 0;
  for (const lecture of lectures) chunks += ingestLecture(lecture.id);

  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  const courses = db.prepare('SELECT COUNT(*) AS count FROM courses').get() as { count: number };
  return { users: users.count, courses: courses.count, chunks };
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  ensureBadgeCatalog();
  const result = seedIfEmpty();
  console.log(
    result.users
      ? `Seeded ${result.users} users, ${result.courses} courses and ${result.chunks} indexed chunks.`
      : 'Database already contains users — nothing seeded. Delete data/vertexlearn.sqlite to reseed.',
  );
}
