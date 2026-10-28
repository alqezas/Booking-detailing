import {VStack} from '@astryxdesign/core/VStack';
import {useTenant} from '../../app/tenant.tsx';
import {Hero} from '../../components/home/Hero.tsx';
import {InstallHint} from '../../components/InstallHint.tsx';
import {PageContainer} from '../../components/layout/Page.tsx';
import {
  AboutSection,
  AssistantTeaser,
  BookingCard,
  ContactsSection,
  FaqSection,
  GallerySection,
  InfoCardsSection,
  ServicesSection,
} from '../../components/home/Sections.tsx';
import {TireBookingCard, TirePricesSection, TireSeasonSection} from '../../components/tire/TireSections.tsx';

/**
 * Layout contract: every block sits in PageContainer, so the hero text and all
 * sections share one left edge, and the sections follow one another in a
 * single column at every width. A tyre service with a price matrix shows the
 * calculator instead of the popular services, a price list per vehicle and
 * rim type instead of service cards, and its seasons and tyre hotel.
 */
export function HomePage() {
  const t = useTenant();
  const tire = t.kind === 'tireservice' && !!t.tire;
  return (
    <VStack>
      <Hero />
      <PageContainer style={{paddingBlock: 'var(--spacing-6)'}}>
        <VStack gap={8}>
          <AboutSection />
          {tire ? <TireBookingCard /> : <BookingCard />}
          <InfoCardsSection />
          {tire ? <TirePricesSection /> : <ServicesSection />}
          {tire && <TireSeasonSection />}
          <GallerySection />
          <AssistantTeaser />
          <FaqSection />
          <ContactsSection />
          <InstallHint />
        </VStack>
      </PageContainer>
    </VStack>
  );
}
