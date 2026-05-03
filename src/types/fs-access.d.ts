// Ambient declarations for File System Access API methods that the default
// lib.dom.d.ts (TypeScript 6) ships only partially. Versions of TS bundled with
// our toolchain expose FileSystemDirectoryHandle / FileSystemFileHandle but not
// the permission helpers nor `Window.showDirectoryPicker`.
// Spec: https://wicg.github.io/file-system-access/

interface ShowDirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?:
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos'
    | FileSystemHandle;
}

interface Window {
  showDirectoryPicker?: (
    opts?: ShowDirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?: (
    desc?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>;
  requestPermission?: (
    desc?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>;
}
