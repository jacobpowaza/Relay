"use client";

import { AlertTriangle, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Stamps `.app-idle` on <html> whenever the window is hidden or unfocused, so
 * the stylesheet can freeze looping animations instead of compositing frames
 * nobody is watching. See the "idle power" block in globals.css.
 *
 * Blur counts as idle, not just visibility: a Relay window fully covered by
 * another app still reports visibilityState "visible" on macOS, which is the
 * common laptop case this is meant to catch.
 *
 * Mounted once, at the app root. It writes a class rather than lifting idleness
 * into React state on purpose — this must not re-render the tree on every focus
 * change, which would cost more than the animations it saves.
 */
export function useIdleClass(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.classList.toggle("app-idle", document.visibilityState === "hidden" || !document.hasFocus());
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      root.classList.remove("app-idle");
    };
  }, []);
}

/**
 * Whether the document is currently visible. Unlike useIdleClass this DOES
 * re-render, because callers use it to suspend polling loops — and a timer that
 * keeps firing behind a hidden window is a battery cost with no reader.
 *
 * Keyed on visibility rather than focus: a poll is still worth running in a
 * visible-but-unfocused window, where the user can see the result.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onEscape]);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

export function useFocusTrap(active = true) {
  const containerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    if (container !== null) {
      const initial = container.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements(container)[0];
      initial?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || containerRef.current === null) return;
      const elements = focusableElements(containerRef.current);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (first === undefined || last === undefined) return;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !containerRef.current.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !containerRef.current.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);
  return containerRef;
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  requireText,
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  requireText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const messageId = useId();
  const [typed, setTyped] = useState("");
  const containerRef = useFocusTrap();
  useEscapeKey(onCancel, !busy);
  const confirmBlocked = busy || (requireText !== undefined && typed.trim() !== requireText);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        className={`modal confirm-dialog${danger ? " danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        ref={(node) => { containerRef.current = node; }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-head">
          {danger && <span className="confirm-dialog-icon" aria-hidden="true"><AlertTriangle size={19} /></span>}
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close" disabled={busy}>
            <X size={17} />
          </button>
        </div>
        <p id={messageId} className="confirm-dialog-message">{message}</p>
        {detail !== undefined && <p className="confirm-dialog-detail">{detail}</p>}
        {requireText !== undefined && (
          <label className="confirm-dialog-verify">
            <span>Type <code>{requireText}</code> to confirm</span>
            <input
              data-autofocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={requireText}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        {children}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            className={danger ? "danger-button" : "primary-button"}
            type="button"
            data-autofocus={requireText === undefined ? true : undefined}
            disabled={confirmBlocked}
            onClick={onConfirm}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function TextFieldModal({
  title,
  eyebrow,
  label,
  initialValue = "",
  placeholder,
  submitLabel,
  multiline = false,
  maxLength = 120,
  allowUnchanged = false,
  validate,
  onCancel,
  onSubmit,
}: {
  title: string;
  eyebrow?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  multiline?: boolean;
  maxLength?: number;
  allowUnchanged?: boolean;
  validate?: (value: string) => string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const titleId = useId();
  const errorId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useFocusTrap();
  useEscapeKey(onCancel);

  const trimmed = value.trim();
  const unchanged = trimmed === initialValue.trim();
  const blocked = trimmed === "" || (!allowUnchanged && unchanged);

  function submit() {
    if (blocked) return;
    const validationError = validate?.(trimmed) ?? null;
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal text-field-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={(node) => { containerRef.current = node; }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            {eyebrow !== undefined && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            {label}
            {multiline ? (
              <textarea
                data-autofocus
                value={value}
                maxLength={maxLength}
                placeholder={placeholder}
                aria-invalid={error !== null}
                aria-describedby={error === null ? undefined : errorId}
                onChange={(event) => { setValue(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submit();
                  }
                }}
                onFocus={(event) => event.target.select()}
              />
            ) : (
              <input
                data-autofocus
                value={value}
                maxLength={maxLength}
                placeholder={placeholder}
                aria-invalid={error !== null}
                aria-describedby={error === null ? undefined : errorId}
                onChange={(event) => { setValue(event.target.value); setError(null); }}
                onFocus={(event) => event.target.select()}
              />
            )}
          </label>
          {error !== null && <p className="field-error" id={errorId} role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="primary-button" type="submit" disabled={blocked}>{submitLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export function ContextMenu({
  position,
  items,
  label,
  onClose,
}: {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(position);
  useEscapeKey(onClose);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const x = Math.max(margin, Math.min(position.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(position.y, window.innerHeight - rect.height - margin));
    setPlaced({ x, y });
    const firstEnabled = menu.querySelector<HTMLElement>("button:not([disabled])");
    firstEnabled?.focus();
  }, [position]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (event.type === "contextmenu" && event.defaultPrevented) return;
      if (menuRef.current !== null && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        onClose();
      }
    }
    function handleBlurClose() {
      onClose();
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("contextmenu", handlePointerDown);
    window.addEventListener("resize", handleBlurClose);
    window.addEventListener("scroll", handleBlurClose, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("contextmenu", handlePointerDown);
      window.removeEventListener("resize", handleBlurClose);
      window.removeEventListener("scroll", handleBlurClose, true);
    };
  }, [onClose]);

  function moveFocus(direction: 1 | -1) {
    const menu = menuRef.current;
    if (menu === null) return;
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    if (buttons.length === 0) return;
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    next?.focus();
  }

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label={label}
      ref={menuRef}
      style={{ left: placed.x, top: placed.y }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
        if (event.key === "Tab") { event.preventDefault(); moveFocus(event.shiftKey ? -1 : 1); }
      }}
    >
      {items.map((item) => (
        <div key={item.key} className={item.separatorBefore ? "context-menu-group" : undefined}>
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ToastMessage {
  id: string;
  tone: "error" | "info" | "success";
  message: string;
}

export function ToastShelf({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-shelf" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
