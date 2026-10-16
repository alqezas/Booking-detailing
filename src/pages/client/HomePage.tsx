import {VStack} from '@astryxdesign/core/VStack';
import {Hero} from '../../components/home/Hero.tsx';
import {InstallHint} from '../../components/InstallHint.tsx';
import {
  AboutSection,
  AssistantTeaser,
  BookingCard,
  ContactsSection,
  GallerySection,
  InfoCardsSection,
  ServicesSection,
} from '../../components/home/Sections.tsx';

export function HomePage() {
  return (
    <VStack>
      <Hero />
      <VStack maxWidth={760} width="100%" style={{marginInline: 'auto'}}>
        <AboutSection />
        <BookingCard />
        <InfoCardsSection />
        <ServicesSection limit={4} />
        <GallerySection />
        <AssistantTeaser />
        <ContactsSection />
        <InstallHint />
      </VStack>
    </VStack>
  );
}
