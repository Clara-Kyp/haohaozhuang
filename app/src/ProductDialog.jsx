import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ProductDialog({ label, className, onDismiss, dismissOnBackdrop, children }) {
  const dialogRef = useRef(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function keepTabInside(event) {
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const dialog = dialogRef.current;
    const controls = Array.from(dialog.querySelectorAll(
      'button, a[href], input, select, textarea, details > summary:first-of-type, [tabindex]',
    )).filter(control =>
      (control.tabIndex >= 0 || control.matches('summary:not([tabindex])')) &&
      !control.matches(':disabled') &&
      control.checkVisibility({ visibilityProperty: true })
    );
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className={className}
      aria-label={label}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      onKeyDown={keepTabInside}
      onClick={event => {
        if (!dismissOnBackdrop || event.target !== event.currentTarget) return;
        const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onDismiss();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
