/* ---------------------------------------------------------------------------
   Hardware back button.

   The Android shell calls window.__azolveBack() before it navigates history. If
   that function returns true the press is considered consumed — a sheet or a
   dialog closed, and the app stays where it is. It was never defined, so every
   back press fell straight through to history: an open modal stayed open while
   the page underneath changed, which is how the "+" sheet ended up stuck.

   Handlers are a stack: the most recently registered one is asked first, which
   is what you want when a dialog opens on top of a sheet.
   ------------------------------------------------------------------------- */

const stack = [];

/** Register a dismiss handler. Returns an unregister function. */
export function pushBackHandler(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i !== -1) stack.splice(i, 1);
  };
}

export function installBackBridge() {
  if (typeof window === 'undefined' || window.__azolveBack) return;
  window.__azolveBack = () => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      try {
        if (stack[i]() === true) return true;
      } catch { /* a broken handler must not block the press */ }
    }
    return false;
  };
}
