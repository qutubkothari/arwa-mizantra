'use client';

import { useEffect } from 'react';

const overlaySelector = 'div.fixed.inset-0';

function isLikelyModalOverlay(element: Element): boolean {
  const classList = element.classList;
  return (
    classList.contains('fixed') &&
    classList.contains('inset-0') &&
    (classList.contains('bg-black') || classList.contains('bg-gray-600') || classList.contains('bg-black/40'))
  );
}

function enhanceOverlay(overlay: HTMLElement) {
  if (overlay.dataset.modalEnhanced === 'true') return;
  if (overlay.dataset.noModalEnhancer === 'true') return;

  const panel = overlay.firstElementChild as HTMLElement | null;
  if (!panel) return;
  if (panel.dataset.noModalEnhancer === 'true') return;

  overlay.dataset.modalEnhanced = 'true';
  overlay.classList.add('modal-overlay');
  panel.classList.add('modal-panel');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'modal-toggle-btn';
  button.setAttribute('aria-label', 'Maximize modal');
  button.innerText = '⤢';

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const isMaximized = panel.classList.toggle('modal-maximized');
    overlay.classList.toggle('modal-maximized', isMaximized);
    button.innerText = isMaximized ? '⤡' : '⤢';
    button.setAttribute('aria-label', isMaximized ? 'Restore modal' : 'Maximize modal');
  });

  panel.appendChild(button);
}

export default function ModalEnhancer() {
  useEffect(() => {
    const enhanceAll = () => {
      const overlays = Array.from(document.querySelectorAll(overlaySelector)) as HTMLElement[];
      overlays.forEach((overlay) => {
        if (isLikelyModalOverlay(overlay)) {
          enhanceOverlay(overlay);
        }
      });
    };

    enhanceAll();

    const observer = new MutationObserver(() => {
      enhanceAll();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
