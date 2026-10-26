import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type CertificateInput = {
  studentName: string;
  courseTitle: string;
  instructorName: string;
  issuedAt: string;
  certificateId: string;
};

/** Render an A4-landscape completion certificate. */
export async function renderCertificate(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const { width, height } = page.getSize();

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const indigo = rgb(0.31, 0.27, 0.9);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.39, 0.45, 0.55);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.99, 0.99, 1) });
  page.drawRectangle({ x: 0, y: height - 16, width, height: 16, color: indigo });
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: indigo });
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 72,
    borderColor: rgb(0.89, 0.91, 0.97),
    borderWidth: 1.5,
  });

  const center = (text: string, y: number, font: typeof bold, size: number, color = ink) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
  };

  center('VERTEXLEARN AI', 500, bold, 13, indigo);
  center('CERTIFICATE OF COMPLETION', 466, regular, 11, muted);
  page.drawLine({ start: { x: width / 2 - 40, y: 446 }, end: { x: width / 2 + 40, y: 446 }, thickness: 2, color: indigo });

  center('This certifies that', 400, italic, 13, muted);
  center(input.studentName, 350, bold, 30);
  center('has successfully completed', 315, regular, 13, muted);

  const titleSize = input.courseTitle.length > 46 ? 20 : 26;
  center(input.courseTitle, 265, bold, titleSize, indigo);

  center(
    `Issued ${new Date(input.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    205,
    regular,
    11,
    muted,
  );

  const signatureY = 140;
  page.drawLine({ start: { x: 180, y: signatureY }, end: { x: 360, y: signatureY }, thickness: 1, color: muted });
  page.drawLine({ start: { x: 482, y: signatureY }, end: { x: 662, y: signatureY }, thickness: 1, color: muted });
  center('', 0, regular, 1);
  page.drawText(input.instructorName, { x: 196, y: signatureY + 8, size: 11, font: bold, color: ink });
  page.drawText('Course instructor', { x: 196, y: signatureY - 16, size: 9, font: regular, color: muted });
  page.drawText('VertexLearn AI', { x: 498, y: signatureY + 8, size: 11, font: bold, color: ink });
  page.drawText('Learning platform', { x: 498, y: signatureY - 16, size: 9, font: regular, color: muted });

  const verify = `Certificate ID ${input.certificateId}  •  Verify at vertexlearn.ai/verify`;
  page.drawText(verify, {
    x: (width - regular.widthOfTextAtSize(verify, 8)) / 2,
    y: 62,
    size: 8,
    font: regular,
    color: muted,
  });

  return pdf.save();
}
