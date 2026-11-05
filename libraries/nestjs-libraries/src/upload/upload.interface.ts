export interface IUploadProvider {
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
  // Bytes of a stored file, from the public URL a media row keeps. Null when
  // the file is not in this storage or its size cannot be read: the media
  // library counts it as 0 then.
  sizeOf?(filePath: string): Promise<number | null>;
}
