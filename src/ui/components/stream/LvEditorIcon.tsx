const M: Record<string, string> = {
  eye: '◉',
  vscode: 'V',
  cursor: '›',
  jb: 'J',
  sublime: 'S',
  zed: 'Z',
  copy: '⎘',
};

export interface LvEditorIconProps {
  readonly icon: string;
}

export const LvEditorIcon = ({ icon }: LvEditorIconProps) => (
  <span className="lv-ed-ico">{M[icon] ?? '·'}</span>
);
