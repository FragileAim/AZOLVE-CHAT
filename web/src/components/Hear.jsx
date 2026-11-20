import React, { useEffect, useState } from 'react';
import { Icon } from './UI.jsx';
import { useSpeech, whenVoicesReady, resolveVoice, speechSupported } from '../lib/speech.js';
import { langOf } from '../lib/i18n.js';

/* animated equalizer shown while a clip is playing */
export function SpeakingBars({ small }) {
  return (
    <span className={`hear-bars ${small ? 'sm' : ''}`} aria-hidden>
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * Tap-to-hear control.
 * variant: 'chip' (pill with label) | 'icon' (round icon only) | 'inline' (text link)
 */
export default function Hear({
  text,
  lang = 'en',
  id,
  label,
  variant = 'chip',
  rate = 1,
  onUnavailable,
  className = '',
}) {
  const sp = useSpeech();
  const [ready, setReady] = useState(false);
  const playing = sp.isPlaying(id);
  const language = langOf(lang);

  useEffect(() => { whenVoicesReady().then(() => setReady(true)); }, []);

  const quality = ready ? resolveVoice(lang).quality : 'unknown';
  const approximate = quality === 'approximate';

  const onClick = (e) => {
    e.stopPropagation();
    if (!speechSupported()) {
      onUnavailable?.('This browser does not support speech. Try Chrome, Edge, Safari or Firefox.');
      return;
    }
    if (quality === 'none') {
      onUnavailable?.(`No speech voices are installed on this device, so ${language.native} cannot be spoken here.`);
      return;
    }
    sp.toggle({ text, lang, id, rate });
  };

  const title = playing
    ? 'Stop'
    : approximate
      ? `No native ${language.native} voice — using the closest installed voice`
      : `Hear this in ${language.native}`;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={`hear-icon ${playing ? 'on' : ''} ${className}`}
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-pressed={playing}
      >
        {playing ? <SpeakingBars small /> : <Icon name="volume" size={14} />}
      </button>
    );
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        className={`hear-inline ${playing ? 'on' : ''} ${className}`}
        onClick={onClick}
        title={title}
        aria-pressed={playing}
      >
        {playing ? <SpeakingBars small /> : <Icon name="volume" size={11} />}
        {playing ? 'Stop' : (label || `Hear in ${language.native}`)}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`hear-chip ${playing ? 'on' : ''} ${approximate ? 'approx' : ''} ${className}`}
      onClick={onClick}
      title={title}
      aria-pressed={playing}
    >
      {playing ? <SpeakingBars /> : <Icon name="volume" size={13} />}
      <span>{playing ? 'Speaking…' : (label || `Hear in ${language.native}`)}</span>
    </button>
  );
}
