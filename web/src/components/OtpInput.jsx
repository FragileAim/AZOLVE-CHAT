import React, { useEffect, useRef } from 'react';

/**
 * Six separate one-digit boxes for a verification code.
 *
 * Behaviour a person actually expects from an OTP field:
 *   - typing a digit jumps to the next box
 *   - backspace on an empty box clears and jumps back
 *   - arrow keys move between boxes
 *   - pasting "123456" (or "123 456", or a full SMS line) fills every box
 *   - the sixth digit fires onComplete() so verification starts on its own
 *
 * The value is always a plain digit string, so callers keep using form.code
 * exactly as before.
 */
export default function OtpInput({
  value = '',
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  autoFocus = true,
  ariaLabel = 'Verification code',
}) {
  const refs = useRef([]);
  const chars = value.split('').slice(0, length);

  const focusBox = (i) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    if (el) { el.focus(); try { el.select(); } catch { /* older WebViews */ } }
  };

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => focusBox(value.length >= length ? length - 1 : value.length), 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (next) => {
    const clean = String(next).replace(/\D/g, '').slice(0, length);
    onChange?.(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const setAt = (i, ch) => {
    const arr = value.split('');
    while (arr.length < i) arr.push('');
    arr[i] = ch;
    return emit(arr.join(''));
  };

  const handleChange = (i, e) => {
    const raw = String(e.target.value || '').replace(/\D/g, '');
    if (!raw) { setAt(i, ''); return; }
    if (raw.length > 1) {
      // Some Android keyboards / autofill drop the whole code into one box.
      emit(raw);
      focusBox(raw.length);
      return;
    }
    setAt(i, raw);
    focusBox(i + 1);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (chars[i]) setAt(i, '');
      else if (i > 0) { setAt(i - 1, ''); focusBox(i - 1); }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      setAt(i, '');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); focusBox(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); focusBox(i + 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (value.length === length) onComplete?.(value);
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
    }
  };

  const handlePaste = (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const clean = text.replace(/\D/g, '').slice(0, length);
    if (!clean) return;
    e.preventDefault();
    emit(clean);
    focusBox(clean.length);
  };

  return (
    <div className="ux-otp-boxes" role="group" aria-label={ariaLabel} onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className={`ux-otp-box${chars[i] ? ' filled' : (i === chars.length ? ' active' : ' empty')}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={chars[i] || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => { try { e.target.select(); } catch { /* noop */ } }}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
        />
      ))}
    </div>
  );
}
