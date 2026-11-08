export interface IUploadProvider {
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
  // Bytes of a stored file, from the public URL a media row keeps. Null when
  // the file is not in this storage or its size cannot be read: the media
  // library counts it as 0 then.
  sizeOf?(filePath: string): Promise<number | null>;
  // Every stored object, for the sweep of files nothing refers to. A storage
  // that cannot list (local disk) leaves it out and the sweep skips.
  listStored?(): AsyncGenerator<StoredObject>;
  // Removes one listed object and throws when the storage refuses, so a
  // sweep can count what really went (removeFile only logs a failure).
  removeStored?(item: StoredObject): Promise<void>;
}

export interface StoredObject {
  key: string;
  /** The public URL a row would keep for it. */
  path: string;
  lastModified: Date;
  size: number;
}
