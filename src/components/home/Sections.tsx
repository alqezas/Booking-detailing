import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Lightbox} from '@astryxdesign/core/Lightbox';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {
  Car,
  ChatCircleDots,
  Clock,
  Coffee,
  CreditCard,
  Drop,
  EnvelopeSimple,
  FacebookLogo,
  InstagramLogo,
  MapPin,
  Medal,
  NavigationArrow,
  Phone,
  ShieldCheck,
  Sparkle,
  Sun,
  TelegramLogo,
  WhatsappLogo,
  Wrench,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import {useMemo, useState, type ReactNode} from 'react';
import {useNavigate} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {formatDate, formatDuration, formatPhone, formatPrice, summarizeHours} from '../../lib/format.ts';
import {msg} from '../../i18n/index.ts';
import type {GalleryItem} from '../../lib/types.ts';
import {mediaUrl} from '../../lib/media.ts';
import {useReveal} from '../../lib/motion.ts';
import {useBookingFlow} from '../booking/BookingFlow.tsx';
import {TEXT_MAX_WIDTH} from '../layout/Page.tsx';

const CARD_ICONS: Record<string, PhosphorIcon> = {
  shield: ShieldCheck,
  sparkle: Sparkle,
  clock: Clock,
  drop: Drop,
  car: Car,
  wrench: Wrench,
  medal: Medal,
  sun: Sun,
  coffee: Coffee,
  'credit-card': CreditCard,
};

/** Example questions for the assistant, in the studio language. */
export const assistantExamples = () => msg.home.assistantExamples;

/** A page section that fades in when scrolled into view (static with reduced motion). */
export function RevealSection({title, id, children, action}: {title: string; id?: string; children: ReactNode; action?: ReactNode}) {
  const {ref, style} = useReveal<HTMLElement>();
  return (
    <Section ref={ref} role="region" aria-labelledby={id} variant="transparent" padding={0} style={style}>
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={2}>
          <Heading level={2} id={id}>
            {title}
          </Heading>
          {action}
        </HStack>
        {children}
      </VStack>
    </Section>
  );
}

export function AboutSection() {
  const t = useTenant();
  if (!t.description) return null;
  return (
    <RevealSection title={msg.home.about} id="about-title">
      {/* Regular body text in the secondary colour: an introduction, not a headline. */}
      <Text color="secondary" textWrap="pretty" style={{maxWidth: TEXT_MAX_WIDTH}}>
        {t.description}
      </Text>
    </RevealSection>
  );
}

export function BookingCard() {
  const t = useTenant();
  const flow = useBookingFlow();
  const popular = t.services.slice(0, 3);
  return (
    <RevealSection title={msg.home.bookingTitle} id="booking-title">
      <Card padding={4} variant="default">
        <VStack gap={3}>
          <Text color="secondary">{msg.home.bookingLead}</Text>
          <List hasDividers>
            {popular.map(s => (
              <ListItem
                key={s.id}
                label={s.name}
                description={`${formatPrice(s.price, s.price_from, t.currency)} · ${formatDuration(s.duration_minutes)}`}
                endContent={<Button label={msg.home.bookService(s.name)} size="sm" onClick={() => flow.open(s.id)}>{msg.home.choose}</Button>}
              />
            ))}
          </List>
          <Button label={msg.home.pickServiceAndTime} variant="primary" size="lg" width="100%" onClick={() => flow.open()} />
        </VStack>
      </Card>
    </RevealSection>
  );
}

export function InfoCardsSection() {
  const t = useTenant();
  if (!t.info_cards.length) return null;
  return (
    <RevealSection title={msg.home.why} id="why-title">
      <Grid columns={{minWidth: 220, max: 3}} gap={3}>
        {t.info_cards.map(c => (
          <Card key={c.position} padding={4}>
            <VStack gap={2}>
              <Icon icon={CARD_ICONS[c.icon] ?? Sparkle} color="accent" size="lg" />
              <Heading level={3}>{c.title}</Heading>
              <Text color="secondary">{c.text}</Text>
            </VStack>
          </Card>
        ))}
      </Grid>
    </RevealSection>
  );
}

/**
 * Services grouped by category: one tab per category, the chosen category's
 * services as cards. A long price list stays easy to scan.
 */
export function ServicesSection() {
  const t = useTenant();
  const flow = useBookingFlow();
  const categories = useMemo(() => [...new Set(t.services.map(s => s.category))], [t.services]);
  const [picked, setPicked] = useState<string | null>(null);
  const category = picked && categories.includes(picked) ? picked : (categories[0] ?? '');
  const list = categories.length > 1 ? t.services.filter(s => s.category === category) : t.services;
  return (
    <RevealSection title={msg.home.services} id="services-title">
      {categories.length > 1 && (
        <TabList value={category} onChange={setPicked} overflow="scroll" size="md" aria-label={msg.home.categories}>
          {categories.map(c => (
            <Tab key={c} value={c} label={c} />
          ))}
        </TabList>
      )}
      <Grid columns={{minWidth: 260, max: 3}} gap={3}>
        {list.map(s => (
          <Card key={s.id} padding={4}>
            <VStack gap={3} style={{height: '100%'}}>
              <VStack gap={1}>
                <Heading level={3}>{s.name}</Heading>
                <Text type="large" weight="bold" hasTabularNumbers>
                  {formatPrice(s.price, s.price_from, t.currency)}
                </Text>
                <Text type="supporting">{formatDuration(s.duration_minutes)}</Text>
              </VStack>
              {s.description && (
                <Text color="secondary" textWrap="pretty">
                  {s.description}
                </Text>
              )}
              <VStack style={{marginTop: 'auto'}}>
                <Button label={msg.home.bookService(s.name)} variant="secondary" width="100%" onClick={() => flow.open(s.id)}>
                  {msg.home.bookShort}
                </Button>
              </VStack>
            </VStack>
          </Card>
        ))}
      </Grid>
    </RevealSection>
  );
}

/** Frequently asked questions: one collapsible card per question. */
export function FaqSection() {
  const t = useTenant();
  if (!t.faq?.length) return null;
  return (
    <RevealSection title={msg.home.faq} id="faq-title">
      <VStack gap={2}>
        {t.faq.map(f => (
          <Card key={f.question} padding={4}>
            <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">{f.question}</Text>}>
              <VStack paddingBlockStart={3}>
                <Text color="secondary" textWrap="pretty" style={{whiteSpace: 'pre-line', maxWidth: TEXT_MAX_WIDTH}}>
                  {f.answer}
                </Text>
              </VStack>
            </Collapsible>
          </Card>
        ))}
      </VStack>
    </RevealSection>
  );
}

/** Fixed-ratio photo: the grid never reflows while photos load. */
function Photo({src, alt, ratio, label}: {src: string; alt: string; ratio: string; label?: string}) {
  return (
    <VStack style={{position: 'relative', flex: 1, minWidth: 0}}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        width={600}
        height={450}
        style={{width: '100%', height: 'auto', aspectRatio: ratio, objectFit: 'cover', display: 'block', background: 'var(--color-background-muted)'}}
      />
      {label && (
        <VStack
          aria-hidden="true"
          paddingInline={2}
          paddingBlock={0.5}
          style={{position: 'absolute', top: 'var(--spacing-2)', left: 'var(--spacing-2)', borderRadius: 'var(--radius-element)', background: 'rgba(0, 0, 0, 0.62)'}}
        >
          <Text type="supporting" weight="semibold" color="primary">
            {label}
          </Text>
        </VStack>
      )}
    </VStack>
  );
}

export function GallerySection() {
  const t = useTenant();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (!t.gallery.length) return null;
  const url = (g: GalleryItem, path: string) => mediaUrl(path, g.updated_at) ?? '';
  const alt = (g: GalleryItem, label?: string) => [g.caption || msg.home.workPhoto, label].filter(Boolean).join(' — ');
  // One lightbox for everything: a «before / after» card contributes two photos.
  const media: {type: 'image'; src: string; alt: string}[] = [];
  const firstIndex = t.gallery.map(g => {
    const at = media.length;
    if (g.before_path) media.push({type: 'image', src: url(g, g.before_path), alt: alt(g, msg.home.before)});
    media.push({type: 'image', src: url(g, g.image_path), alt: alt(g, g.before_path ? msg.home.after : undefined)});
    return at;
  });
  // Side-by-side pairs need wider cards: one per row on phones.
  const hasPairs = t.gallery.some(g => g.before_path);
  return (
    <RevealSection title={msg.home.gallery} id="gallery-title">
      <Grid columns={hasPairs ? {minWidth: 280, max: 3} : {minWidth: 160, max: 4}} gap={3}>
        {t.gallery.map((g, i) => (
          <ClickableCard
            key={g.id}
            label={g.caption ? msg.home.openPhoto(g.caption) : msg.home.openAnyPhoto}
            padding={0}
            variant="transparent"
            onClick={() => {
              setIndex(firstIndex[i]!);
              setOpen(true);
            }}
          >
            <VStack gap={1}>
              <HStack gap={0.5} style={{borderRadius: 'var(--radius-container)', overflow: 'hidden'}}>
                {g.before_path ? (
                  <>
                    <Photo src={url(g, g.before_path)} alt={alt(g, msg.home.before)} ratio="3 / 4" label={msg.home.before} />
                    <Photo src={url(g, g.image_path)} alt={alt(g, msg.home.after)} ratio="3 / 4" label={msg.home.after} />
                  </>
                ) : (
                  <Photo src={url(g, g.image_path)} alt={alt(g)} ratio="4 / 3" />
                )}
              </HStack>
              {/* Captions are short (≤ 120 chars): wrap rather than truncate. The inset keeps
                  the last line clear of the card's rounded, clipped corners. */}
              {g.caption && (
                <VStack paddingInline={2} paddingBlockEnd={2}>
                  <Text type="supporting">{g.caption}</Text>
                </VStack>
              )}
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
      <Lightbox isOpen={open} onOpenChange={setOpen} media={media} index={index} onIndexChange={setIndex} hasZoom />
    </RevealSection>
  );
}

export function ContactsSection() {
  const t = useTenant();
  const hours = summarizeHours(t.hours);
  const closedSoon = t.exceptions.filter(e => e.is_closed).slice(0, 3);
  const mapHref = t.map_url ?? msg.mapSearch(t.address);
  return (
    <RevealSection title={msg.home.contacts} id="contacts-title">
      <Card padding={4}>
        <VStack gap={4}>
          <HStack gap={3} align="start">
            <Icon icon={MapPin} color="accent" />
            <VStack gap={2}>
              <Text weight="semibold">{t.address}</Text>
              {t.legal_address && t.legal_address !== t.address && (
                <Text type="supporting">
                  {msg.home.legalAddress}: {t.legal_address}
                </Text>
              )}
              <Button label={msg.home.route} icon={<Icon icon={NavigationArrow} />} href={mapHref} target="_blank" size="sm" />
            </VStack>
          </HStack>
          <HStack gap={3} align="start">
            <Icon icon={Clock} color="accent" />
            <VStack gap={1}>
              {hours.map(h => (
                <HStack key={h.days} gap={3}>
                  <Text weight="semibold" style={{minWidth: '5.5em'}}>
                    {h.days}
                  </Text>
                  <Text color={h.closed ? 'secondary' : 'primary'} hasTabularNumbers>
                    {h.hours}
                  </Text>
                </HStack>
              ))}
              {closedSoon.length > 0 && (
                <Text type="supporting">
                  {msg.home.closedOn}
                  {closedSoon.map(e => formatDate(e.day)).join(', ')}
                </Text>
              )}
            </VStack>
          </HStack>
          <HStack gap={3} align="center">
            <Icon icon={Phone} color="accent" />
            <Button label={msg.home.call(formatPhone(t.phone))} variant="ghost" href={`tel:${t.phone}`}>
              {formatPhone(t.phone)}
            </Button>
          </HStack>
          {t.email && (
            <HStack gap={3} align="center">
              <Icon icon={EnvelopeSimple} color="accent" />
              <Button label={t.email} variant="ghost" href={`mailto:${t.email}`} />
            </HStack>
          )}
          {(t.telegram || t.whatsapp || t.instagram || t.facebook) && (
            <HStack gap={2} wrap="wrap">
              {t.instagram && (
                <Button label="Instagram" icon={<Icon icon={InstagramLogo} />} href={`https://www.instagram.com/${t.instagram.replace(/^@/, '')}`} target="_blank" size="sm" />
              )}
              {t.facebook && (
                <Button label="Facebook" icon={<Icon icon={FacebookLogo} />} href={`https://www.facebook.com/${t.facebook}`} target="_blank" size="sm" />
              )}
              {t.telegram && (
                <Button label="Telegram" icon={<Icon icon={TelegramLogo} />} href={`https://t.me/${t.telegram.replace(/^@/, '')}`} target="_blank" size="sm" />
              )}
              {t.whatsapp && (
                <Button label="WhatsApp" icon={<Icon icon={WhatsappLogo} />} href={`https://wa.me/${t.whatsapp.replace(/\D/g, '')}`} target="_blank" size="sm" />
              )}
            </HStack>
          )}
        </VStack>
      </Card>
    </RevealSection>
  );
}

export function AssistantTeaser() {
  const t = useTenant();
  const navigate = useNavigate();
  if (!t.assistant_enabled) return null;
  const ask = (q: string) => navigate(`/s/${t.slug}/assistant?q=${encodeURIComponent(q)}`);
  return (
    <RevealSection title={msg.home.assistantTitle} id="assistant-title">
      <Card padding={4}>
        <VStack gap={3}>
          <HStack gap={2} align="center">
            <Icon icon={ChatCircleDots} color="accent" />
            <Text color="secondary">{msg.home.assistantLead}</Text>
          </HStack>
          <HStack gap={2} wrap="wrap">
            {assistantExamples().map(q => (
              <Button key={q} label={q} size="md" onClick={() => ask(q)} />
            ))}
          </HStack>
        </VStack>
      </Card>
    </RevealSection>
  );
}
