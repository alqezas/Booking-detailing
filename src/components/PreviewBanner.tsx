import {Banner} from '@astryxdesign/core/Banner';

/** Shown on every page of a studio that has not been activated yet. */
export function PreviewBanner() {
  return (
    <Banner
      status="info"
      container="section"
      title="Образец приложения"
      description="Записи здесь демонстрационные и не попадут в работу студии. Уведомления не отправляются."
      collapsible={false}
    />
  );
}
