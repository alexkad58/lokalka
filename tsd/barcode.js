import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer
} from "@zxing/library";
import sharp from "sharp";

const hints = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true]
]);

export async function readBarcode(image) {
  const { data, info } = await sharp(image)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const source = new RGBLuminanceSource(data, info.width, info.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));

  const reader = new MultiFormatReader();
  reader.setHints(hints);

  try {
    const result = reader.decode(bitmap);
    return {
      format: result.getBarcodeFormat().toString(),
      data: result.getText(),
    };
  } catch (error) {
    console.error("Barcode read failed:", error?.message ?? error);
    return null;
  }
}
