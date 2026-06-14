/**
 * Minimal in-memory File System Access API stand-in. Implements only the
 * surface area that `OpfsSingleSpoolWriter` / `OpfsChunkedSpoolWriter` /
 * `*BlobReader` actually call. Don't reach for this outside tests — real
 * OPFS has subtle behaviours we don't reproduce.
 */

class MockFile {
  readonly size: number;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.size = bytes.byteLength;
  }
  slice(start = 0, end = this.size): MockFile {
    const s = Math.max(0, start | 0);
    const e = Math.min(this.size, end | 0);
    return new MockFile(this.bytes.slice(s, e));
  }
  async text(): Promise<string> {
    return new TextDecoder('utf-8').decode(this.bytes);
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer;
  }
}

interface MockFileNode {
  kind: 'file';
  bytes: Uint8Array;
}

interface MockDirNode {
  kind: 'directory';
  children: Map<string, MockFileNode | MockDirNode>;
}

class MockWritable {
  private readonly fileNode: MockFileNode;
  private chunks: Uint8Array[] = [];
  private cursor = 0;

  constructor(fileNode: MockFileNode, keepExistingData: boolean) {
    this.fileNode = fileNode;
    if (keepExistingData) {
      this.chunks.push(fileNode.bytes);
      this.cursor = fileNode.bytes.byteLength;
    }
  }
  async write(
    data: Uint8Array | ArrayBuffer | { type: 'write'; data: Uint8Array },
  ): Promise<void> {
    let bytes: Uint8Array;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (typeof data === 'object' && data !== null && 'data' in data) {
      bytes = (data as { data: Uint8Array }).data;
    } else {
      throw new Error('MockWritable: unsupported write payload');
    }
    this.chunks.push(bytes);
    this.cursor += bytes.byteLength;
  }
  async close(): Promise<void> {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    this.fileNode.bytes = merged;
  }
  async truncate(size: number): Promise<void> {
    void size;
  }
  async seek(): Promise<void> {
    /* not modelled */
  }
}

class MockFileHandle {
  readonly kind = 'file';
  readonly name: string;
  private readonly node: MockFileNode;
  constructor(name: string, node: MockFileNode) {
    this.name = name;
    this.node = node;
  }
  async getFile(): Promise<MockFile> {
    return new MockFile(this.node.bytes);
  }
  async createWritable(opts?: {
    keepExistingData?: boolean;
  }): Promise<MockWritable> {
    return new MockWritable(this.node, !!opts?.keepExistingData);
  }
}

class MockDirHandle {
  readonly kind = 'directory';
  readonly name: string;
  private readonly node: MockDirNode;
  constructor(name: string, node: MockDirNode) {
    this.name = name;
    this.node = node;
  }

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<MockDirHandle> {
    let entry = this.node.children.get(name);
    if (entry === undefined) {
      if (!opts?.create) {
        throw new DOMException(
          `directory '${name}' not found`,
          'NotFoundError',
        );
      }
      entry = { kind: 'directory', children: new Map() };
      this.node.children.set(name, entry);
    } else if (entry.kind !== 'directory') {
      throw new DOMException(
        `'${name}' is not a directory`,
        'TypeMismatchError',
      );
    }
    return new MockDirHandle(name, entry);
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<MockFileHandle> {
    let entry = this.node.children.get(name);
    if (entry === undefined) {
      if (!opts?.create) {
        throw new DOMException(`file '${name}' not found`, 'NotFoundError');
      }
      entry = { kind: 'file', bytes: new Uint8Array(0) };
      this.node.children.set(name, entry);
    } else if (entry.kind !== 'file') {
      throw new DOMException(`'${name}' is not a file`, 'TypeMismatchError');
    }
    return new MockFileHandle(name, entry);
  }

  async removeEntry(
    name: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    const entry = this.node.children.get(name);
    if (entry === undefined) {
      throw new DOMException(`'${name}' not found`, 'NotFoundError');
    }
    if (
      entry.kind === 'directory' &&
      entry.children.size > 0 &&
      !opts?.recursive
    ) {
      throw new DOMException(`'${name}' not empty`, 'InvalidModificationError');
    }
    this.node.children.delete(name);
  }

  async *entries(): AsyncIterable<[string, MockDirHandle | MockFileHandle]> {
    for (const [name, entry] of this.node.children) {
      yield entry.kind === 'directory'
        ? [name, new MockDirHandle(name, entry)]
        : [name, new MockFileHandle(name, entry)];
    }
  }
}

export const createMockOpfsRoot = (): {
  getRoot: () => Promise<FileSystemDirectoryHandle>;
  rawRoot: MockDirHandle;
} => {
  const node: MockDirNode = { kind: 'directory', children: new Map() };
  const handle = new MockDirHandle('', node);
  return {
    getRoot: async () => handle as unknown as FileSystemDirectoryHandle,
    rawRoot: handle,
  };
};

export type { MockDirHandle, MockFileHandle };
