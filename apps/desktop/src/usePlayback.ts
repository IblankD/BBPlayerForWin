import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Track } from './types';
import { PlaybackController } from './player';
import type { PlaybackState } from './player';

export function usePlayback(audio: RefObject<HTMLAudioElement | null>, heard: (track: Track) => void, notice: (message: string) => void) {
  const [state, setState] = useState<PlaybackState>({ queue: [], current: null, parts: [], playing: false, buffering: false, position: 0, duration: 0, status: '' });
  const [controller] = useState(() => new PlaybackController((bvid, cid) => window.desktop.stream(bvid, cid), setState, () => {}, () => {}));
  useEffect(() => { controller.setCallbacks(heard, notice); }, [controller, heard, notice]);
  useEffect(() => {
    if (!audio.current) return;
    const detach = controller.attach(audio.current);
    controller.setOnline(navigator.onLine);
    const online = () => controller.setOnline(true);
    const offline = () => controller.setOnline(false);
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { detach(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [audio, controller]);
  return { ...state, controller };
}
