'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type AlertOptions = {
  title?: string;
  message: string;
  buttonLabel?: string;
};

type ConfirmState = ConfirmOptions & { resolve: (value: boolean) => void };
type AlertState = AlertOptions & { resolve: () => void };

function normalizeConfirmInput(input: ConfirmOptions | string): ConfirmOptions {
  if (typeof input === 'string') return { message: input };
  return input;
}

function normalizeAlertInput(input: AlertOptions | string): AlertOptions {
  if (typeof input === 'string') return { message: input };
  return input;
}

export function useSitePopup() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [alertState, setAlertState] = useState<AlertState | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const normalized = normalizeConfirmInput(options);
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        title: normalized.title || 'Confirm Action',
        message: normalized.message,
        confirmLabel: normalized.confirmLabel || 'Confirm',
        cancelLabel: normalized.cancelLabel || 'Cancel',
        danger: normalized.danger ?? false,
        resolve,
      });
    });
  }, []);

  const showAlert = useCallback((options: AlertOptions | string) => {
    const normalized = normalizeAlertInput(options);
    return new Promise<void>((resolve) => {
      setAlertState({
        title: normalized.title || 'Notice',
        message: normalized.message,
        buttonLabel: normalized.buttonLabel || 'OK',
        resolve,
      });
    });
  }, []);

  const closeConfirm = useCallback((value: boolean) => {
    setConfirmState((prev) => {
      if (prev) prev.resolve(value);
      return null;
    });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState((prev) => {
      if (prev) prev.resolve();
      return null;
    });
  }, []);

  useEffect(() => {
    if (!confirmState && !alertState) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmState) closeConfirm(false);
      if (alertState) closeAlert();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmState, alertState, closeConfirm, closeAlert]);

  const popup = useMemo(() => {
    if (!confirmState && !alertState) return null;

    return (
      <>
        {confirmState && (
          <div className="site-popup-backdrop" role="dialog" aria-modal="true" aria-label={confirmState.title}>
            <div className="site-popup-card animate-fade-in">
              <h3>{confirmState.title}</h3>
              <p>{confirmState.message}</p>
              <div className="site-popup-actions">
                <button className="btn btn-secondary" onClick={() => closeConfirm(false)}>
                  {confirmState.cancelLabel}
                </button>
                <button
                  className={confirmState.danger ? 'site-popup-danger' : 'btn btn-primary'}
                  onClick={() => closeConfirm(true)}
                >
                  {confirmState.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}

        {alertState && (
          <div className="site-popup-backdrop" role="dialog" aria-modal="true" aria-label={alertState.title}>
            <div className="site-popup-card animate-fade-in">
              <h3>{alertState.title}</h3>
              <p>{alertState.message}</p>
              <div className="site-popup-actions">
                <button className="btn btn-primary" onClick={closeAlert}>
                  {alertState.buttonLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }, [alertState, closeAlert, closeConfirm, confirmState]);

  return { confirm, showAlert, popup };
}

