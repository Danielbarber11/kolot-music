import React, { useEffect } from 'react';

interface SecurityGuardProps {
  children: React.ReactNode;
}

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'));
};

export const SecurityGuard: React.FC<SecurityGuardProps> = ({ children }) => {
  useEffect(() => {
    const handleCopyOrCut = (e: ClipboardEvent) => {
      if (isEditableElement(e.target)) return;
      e.preventDefault();
      try {
        e.clipboardData?.clearData();
      } catch {}
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ['c', 'C', 'x', 'X', 's', 'S'].includes(e.key)) {
        e.preventDefault();
      }
    };

    const handleDragStart = (e: DragEvent) => {
      if (e.target instanceof HTMLElement && ['IMG', 'SVG', 'VIDEO', 'A'].includes(e.target.tagName)) {
        e.preventDefault();
      }
      if (!isEditableElement(e.target)) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (isEditableElement(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener('copy', handleCopyOrCut);
    document.addEventListener('cut', handleCopyOrCut);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('copy', handleCopyOrCut);
      document.removeEventListener('cut', handleCopyOrCut);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  return <>{children}</>;
};
