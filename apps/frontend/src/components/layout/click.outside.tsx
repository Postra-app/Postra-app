import { useEffect } from 'react';
export const useClickOutside = (callback: () => Promise<void>) => {
  const handleClick = (event: MouseEvent) => {
    const selector = document.querySelector('#add-edit-modal');
    const emoji = document.querySelector('.EmojiPickerReact');
    if (
      !selector?.contains(event.target as HTMLElement) &&
      !emoji
    ) {
      callback();
    }
  };
  useEffect(() => {
    document
      .querySelector('.mantine-Modal-root')
      // @ts-expect-error ref node union doesn't match the addEventListener overloads
      ?.addEventListener('click', handleClick);
    return () => {
      document
        .querySelector('.mantine-Modal-root')
        // @ts-expect-error ref node union doesn't match the removeEventListener overloads
        ?.removeEventListener('click', handleClick);
    };
  });
};
