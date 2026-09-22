declare module "pngjs" {
  export interface DecodedPngV1 {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
  }

  export const PNG: {
    readonly sync: {
      read(input: Uint8Array): DecodedPngV1;
    };
  };
}
