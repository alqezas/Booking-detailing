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
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {
  Car,
  ChatCircleDots,
  Clock,
  Coffee,
  CreditCard,
  Drop,
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
import {useState, type ReactNode} from 'react';
import {useNavigate} from 'react-router';
import {useTenant} from '../../app/tenant.tsx';
import {formatDuration, formatPhone, formatPrice, summarizeHours} from '../../lib/format.ts';
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

export const ASSISTANT_EXAMPLES = ['Когда ближайшее окно?', 'Сколько стоит полировка?', 'Как найти студию?'];

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
    <RevealSection title="О студии" id="about-title">
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
    <RevealSection title="Запись в студию" id="booking-title">
      <Card padding={4} variant="default">
        <VStack gap={3}>
          <Text color="secondary">Выберите услугу, дату и свободное время — без регистрации, за минуту.</Text>
          <List hasDividers>
            {popular.map(s => (
              <ListItem
                key={s.id}
                label={s.name}
                description={`${formatPrice(s.price, s.price_from, t.currency)} · ${formatDuration(s.duration_minutes)}`}
                endContent={<Button label={`Записаться: ${s.name}`} size="sm" onClick={() => flow.open(s.id)}>Выбрать</Button>}
              />
            ))}
          </List>
          <Button label="Выбрать услугу и время" variant="primary" size="lg" width="100%" onClick={() => flow.open()} />
        </VStack>
      </Card>
    </RevealSection>
  );
}

export function InfoCardsSection() {
  const t = useTenant();
  if (!t.info_cards.length) return null;
  return (
    <RevealSection title="Почему мы" id="why-title">
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

export function ServicesSection({limit}: {limit?: number}) {
  const t = useTenant();
  const flow = useBookingFlow();
  const navigate = useNavigate();
  const list = limit ? t.services.slice(0, limit) : t.services;
  return (
    <RevealSection
      title="Услуги и цены"
      id="services-title"
      action={limit && t.services.length > limit ? <Button label="Все услуги" variant="ghost" size="sm" onClick={() => navigate(`/s/${t.slug}/services`)} /> : undefined}
    >
      <List hasDividers density="spacious">
        {list.map(s => (
          <ListItem
            key={s.id}
            label={s.name}
            description={
              <VStack gap={0.5}>
                {s.description && <Text color="secondary">{s.description}</Text>}
                <Text type="supporting">{formatDuration(s.duration_minutes)}</Text>
              </VStack>
            }
            endContent={
              <VStack gap={1} align="end">
                <Text weight="bold" hasTabularNumbers>
                  {formatPrice(s.price, s.price_from, t.currency)}
                </Text>
                <Button label={`Записаться: ${s.name}`} size="sm" variant="secondary" onClick={() => flow.open(s.id)}>
                  Записаться
                </Button>
              </VStack>
            }
          />
        ))}
      </List>
    </RevealSection>
  );
}

export function GallerySection() {
  const t = useTenant();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (!t.gallery.length) return null;
  const media = t.gallery.map(g => ({type: 'image' as const, src: mediaUrl(g.image_path, g.updated_at) ?? '', alt: g.caption || 'Пример работы'}));
  return (
    <RevealSection title="Наши работы" id="gallery-title">
      <Grid columns={{minWidth: 160, max: 4}} gap={3}>
        {t.gallery.map((g, i) => (
          <ClickableCard
            key={g.id}
            label={g.caption ? `Открыть фото: ${g.caption}` : 'Открыть фото работы'}
            padding={0}
            variant="transparent"
            onClick={() => {
              setIndex(i);
              setOpen(true);
            }}
          >
            <VStack gap={1}>
              {/* Fixed 4:3 box: the grid never reflows while photos load. */}
              <img
                src={media[i]!.src}
                alt={media[i]!.alt}
                loading="lazy"
                decoding="async"
                width={600}
                height={450}
                style={{width: '100%', height: 'auto', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block', borderRadius: 'var(--radius-container)', background: 'var(--color-background-muted)'}}
              />
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
  const mapHref = t.map_url ?? `https://yandex.ru/maps/?text=${encodeURIComponent(t.address)}`;
  return (
    <RevealSection title="Как нас найти" id="contacts-title">
      <Card padding={4}>
        <VStack gap={4}>
          <HStack gap={3} align="start">
            <Icon icon={MapPin} color="accent" />
            <VStack gap={2}>
              <Text weight="semibold">{t.address}</Text>
              <Button label="Построить маршрут" icon={<Icon icon={NavigationArrow} />} href={mapHref} target="_blank" size="sm" />
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
                  <Text color={h.hours === 'Выходной' ? 'secondary' : 'primary'} hasTabularNumbers>
                    {h.hours}
                  </Text>
                </HStack>
              ))}
              {closedSoon.length > 0 && (
                <Text type="supporting">
                  Не работаем: {closedSoon.map(e => new Date(`${e.day}T12:00:00Z`).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})).join(', ')}
                </Text>
              )}
            </VStack>
          </HStack>
          <HStack gap={3} align="center">
            <Icon icon={Phone} color="accent" />
            <Button label={`Позвонить: ${formatPhone(t.phone)}`} variant="ghost" href={`tel:${t.phone}`}>
              {formatPhone(t.phone)}
            </Button>
          </HStack>
          {(t.telegram || t.whatsapp) && (
            <HStack gap={2} wrap="wrap">
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
    <RevealSection title="Спросите помощника" id="assistant-title">
      <Card padding={4}>
        <VStack gap={3}>
          <HStack gap={2} align="center">
            <Icon icon={ChatCircleDots} color="accent" />
            <Text color="secondary">Отвечает по услугам, ценам и свободному времени студии.</Text>
          </HStack>
          <HStack gap={2} wrap="wrap">
            {ASSISTANT_EXAMPLES.map(q => (
              <Button key={q} label={q} size="md" onClick={() => ask(q)} />
            ))}
          </HStack>
        </VStack>
      </Card>
    </RevealSection>
  );
}
