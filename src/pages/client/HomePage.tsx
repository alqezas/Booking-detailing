import {Grid} from '@astryxdesign/core/Grid';
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
 * sections share one left edge. Paired blocks are a reflowing grid: one column
 * on phones, two once each column gets at least 340 px (≈ tablets and up).
 */
export function HomePage() {
  return (
    <VStack>
      <Hero />
      <PageContainer style={{paddingBlock: 'var(--spacing-6)'}}>
        <VStack gap={8}>
          <Grid columns={{minWidth: 340, max: 2}} gap={6} align="start">
            <BookingCard />
            <AboutSection />
          </Grid>
          <InfoCardsSection />
          <ServicesSection limit={4} />
          <GallerySection />
          <Grid columns={{minWidth: 340, max: 2}} gap={6} align="start">
            <ContactsSection />
            <AssistantTeaser />
          </Grid>
          <InstallHint />
        </VStack>
      </PageContainer>
    </VStack>
  );
}
