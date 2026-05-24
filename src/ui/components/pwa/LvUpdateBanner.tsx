import { useRegisterSW } from 'virtual:pwa-register/react';

export const LvUpdateBanner = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      // Best-effort; not fatal — app keeps working without SW.
      console.warn('[PWA] SW register error', err);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="lv-update-banner" role="status" aria-live="polite">
      <span className="lv-update-banner-text">
        Доступно обновление Log Viewer.
      </span>
      <button
        type="button"
        className="lv-update-banner-btn lv-update-banner-primary"
        onClick={() => updateServiceWorker(true)}
      >
        Обновить
      </button>
      <button
        type="button"
        className="lv-update-banner-btn"
        onClick={() => setNeedRefresh(false)}
        aria-label="Закрыть"
        title="Закрыть"
      >
        ✕
      </button>
    </div>
  );
};
