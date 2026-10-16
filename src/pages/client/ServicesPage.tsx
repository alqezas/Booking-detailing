import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {ServicesSection} from '../../components/home/Sections.tsx';
import {PageContainer, PageTitle} from '../../components/layout/Page.tsx';

export default function ServicesPage() {
  const t = useTenant();
  return (
    <PageContainer>
      <PageTitle title="Услуги" description={`${t.name}: цены и длительность. Нажмите «Записаться» у нужной услуги.`} />
      <VStack style={{paddingBlockEnd: 'var(--spacing-6)'}}>
        <ServicesSection />
      </VStack>
    </PageContainer>
  );
}
