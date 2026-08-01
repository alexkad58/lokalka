import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { createCanvas, loadImage } from "canvas";

const CANVAS_WIDTH = 700;
const CANVAS_HEIGHT = 500;
const QR_SIZE = 250;
const BARCODE_WIDTH = 350;
const BARCODE_HEIGHT = 160;
const PADDING = 30;

export async function createImage({ qr, code128, data, name }) {
  const [qrBuffer, barcodeBuffer] = await Promise.all([
    QRCode.toBuffer(qr, { width: QR_SIZE }),
    bwipjs.toBuffer({
      bcid: "code128",
      text: code128,
      scale: 3,
      height: 15,
      includetext: true,
    }),
  ]);

  const [qrImage, barcodeImage] = await Promise.all([
    loadImage(qrBuffer),
    loadImage(barcodeBuffer),
  ]);

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = "#000000";
  ctx.font = "28px sans-serif";
  ctx.fillText(`qr - ${qr}`, PADDING, 50);
  ctx.fillText(`цена - ${data.price}`, PADDING, 90);
  if (name) {
    ctx.fillText(`товар - ${name}`, PADDING, 130);
  }

  ctx.drawImage(qrImage, PADDING, 150, QR_SIZE, QR_SIZE);
  ctx.drawImage(barcodeImage, PADDING + QR_SIZE + 40, 180, BARCODE_WIDTH, BARCODE_HEIGHT);

  return canvas.toBuffer("image/png");
}
