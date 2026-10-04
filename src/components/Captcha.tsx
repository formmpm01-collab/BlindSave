import { useEffect, useRef } from 'react';
declare global {
  interface Window {
    turnstile?: { render: (container: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}
export function Captcha({ onToken, attempt }: { onToken: (token: string) => void; attempt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!sitekey) return;
    let id: string | undefined;
    const render = () => {
      if (ref.current && window.turnstile && !id) id = window.turnstile.render(ref.current, {
        sitekey, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''), theme: 'light',
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (!script) {
      script = document.createElement('script'); script.dataset.turnstile = 'true'; script.async = true;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; document.head.append(script);
    }
    script.addEventListener('load', render); render();
    return () => { script?.removeEventListener('load', render); if (id) window.turnstile?.remove(id); };
  }, [sitekey, onToken, attempt]);
  return sitekey ? <div ref={ref} className="captcha" aria-label="Verificación de seguridad" /> : null;
}
