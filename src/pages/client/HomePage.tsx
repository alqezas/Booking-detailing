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
import {PeakHoursSection, WashBookingCard, WashPricesSection} from '../../components/wash/WashSections.tsx';
import {BeautyHero, MastersStrip, Portfolio, PriceList} from '../../components/beauty/BeautyHome.tsx';

/**
 * Layout contract: every block sits in PageContainer, so the hero text and all
 * sections share one left edge, and the sections follow one another in a
 * single column at every width. A tyre service with a price matrix shows the
 * calculator instead of the popular services, a price list per vehicle and
 * rim type instead of service cards, and its seasons and tyre hotel. A car
 * wash with a price list shows its calculator and prices by car class. Peak
 * hours (any studio) are announced so a closed online slot is no surprise.
 */
export function HomePage() {
  const t = useTenant();
  if (t.kind === 'beauty') return <BeautyHomePage />;
  const tire = t.kind === 'tireservice' && !!t.tire;
  const wash = t.kind === 'carwash' && !!t.wash;
  return (
    <VStack>
      <Hero />
      <PageContainer style={{paddingBlock: 'var(--spacing-6)'}}>
        <VStack gap={8}>
          <AboutSection />
          {tire ? <TireBookingCard /> : wash ? <WashBookingCard /> : <BookingCard />}
          <InfoCardsSection />
          {tire ? <TirePricesSection /> : wash ? <WashPricesSection /> : <ServicesSection />}
          {tire && <TireSeasonSection />}
          <PeakHoursSection />
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

/**
 * Beauty studio: cover + logo + live status, masters (hidden for a solo
 * studio), «Запись в студию» price list with category tabs, portfolio, three
 * info cards, the assistant with one-tap questions, FAQ and contacts.
 */
function BeautyHomePage() {
  return (
    <VStack>
      <BeautyHero />
      <PageContainer style={{paddingBlock: 'var(--spacing-6)'}}>
        <VStack gap={8}>
          <MastersStrip />
          <PriceList />
          <Portfolio />
          <InfoCardsSection />
          <AssistantTeaser />
          <FaqSection />
          <ContactsSection />
          <InstallHint />
        </VStack>
      </PageContainer>
    </VStack>
  );
}
