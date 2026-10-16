import {VStack} from '@astryxdesign/core/VStack';
import {Hero} from '../../components/home/Hero.tsx';
import {InstallHint} from '../../components/InstallHint.tsx';
import {PageContainer} from '../../components/layout/Page.tsx';
import {
  AboutSection,
  AssistantTeaser,
  BookingCard,
  ContactsSection,
  GallerySection,
  InfoCardsSection,
  ServicesSection,
} from '../../components/home/Sections.tsx';

/**
 * Layout contract: every block sits in PageContainer, so the hero text and all
 * sections share one left edge, and the sections follow one another in a
 * single column at every width.
 */
export function HomePage() {
  return (
    <VStack>
      <Hero />
      <PageContainer style={{paddingBlock: 'var(--spacing-6)'}}>
        <VStack gap={8}>
          <AboutSection />
          <BookingCard />
          <InfoCardsSection />
          <ServicesSection limit={4} />
          <GallerySection />
          <AssistantTeaser />
          <ContactsSection />
          <InstallHint />
        </VStack>
      </PageContainer>
    </VStack>
  );
}
