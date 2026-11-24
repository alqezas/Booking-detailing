import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Carousel} from '@astryxdesign/core/Carousel';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {Icon} from '@astryxdesign/core/Icon';
import {Lightbox} from '@astryxdesign/core/Lightbox';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {Check, InstagramLogo, NavigationArrow, Phone, X} from '@phosphor-icons/react';
import {useMemo, useState} from 'react';
import {useTenant} from '../../app/tenant.tsx';
import {beautyMsg} from '../../i18n/beauty.ts';
import {msg} from '../../i18n/index.ts';
import {openState} from '../../lib/beauty.ts';
import {formatDayLabel, formatDuration, formatPrice, hasPhone} from '../../lib/format.ts';
import {mediaUrl} from '../../lib/media.ts';
import {InlineEmpty} from '../StatusScreens.tsx';
import {PageContainer, TEXT_MAX_WIDTH} from '../layout/Page.tsx';
import {RevealSection} from '../home/Sections.tsx';
import {mastersOf, useBeauty} from './BeautyFlow.tsx';

const ALL = '__all__';

/**
 * Cover banner of the interior (not full screen), the round logo sitting on
 * its lower edge, the name, the live opening state, a short description and
 * pill buttons: route, Instagram, call.
 */
export function BeautyHero() {
  const t = useTenant();
  const B = beautyMsg();
  const hero = mediaUrl(t.hero_path);
  const logo = mediaUrl(t.logo_path);
  const state = openState(t.hours, t.exceptions, t.timezone);
  const status = state.open
    ? B.home.openUntil(state.until)
    : state.next
      ? B.home.opensAt(`${formatDayLabel(state.next.date, t.timezone).toLowerCase()}, ${state.next.opens}`)
      : B.home.closedNow;
  const mapHref = t.map_url ?? msg.mapSearch(t.address);
  const pill = {borderRadius: 'var(--radius-full)', minHeight: 44} as const;

  return (
    <VStack as="header">
      <PageContainer style={{paddingBlockStart: 'calc(env(safe-area-inset-top, 0px) + var(--spacing-3))'}}>
        <VStack
          aria-hidden="true"
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 'var(--radius-container)',
            // Full column width at any size: 2:1 on phones, capped height on desktop
            // (an aspect ratio + max-height made the banner shrink to half the screen).
            width: '100%',
            height: 'clamp(170px, 50vw, 400px)',
            background: 'var(--color-background-muted)',
            boxShadow: '0 8px 30px var(--color-shadow)',
          }}
        >
          {hero && (
            <img
              src={hero}
              alt=""
              fetchPriority="high"
              decoding="async"
              width={1600}
              height={800}
              style={{width: '100%', height: '100%', objectFit: 'cover', display: 'block'}}
            />
          )}
        </VStack>
      </PageContainer>
      <PageContainer>
        <VStack gap={3} style={{marginTop: -48, position: 'relative'}}>
          <VStack
            style={{
              width: 96,
              height: 96,
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              border: '4px solid var(--color-background-card)',
              background: 'var(--color-background-card)',
              boxShadow: '0 6px 20px var(--color-shadow)',
              marginInlineStart: 'var(--spacing-2)',
            }}
          >
            {logo && <img src={logo} alt={t.name} width={96} height={96} style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
          </VStack>
          <VStack gap={1}>
            <Heading level={1} textWrap="balance">
              {t.name}
            </Heading>
            <HStack gap={2} align="center" role="status">
              <VStack
                aria-hidden="true"
                style={{width: 8, height: 8, borderRadius: 'var(--radius-full)', background: state.open ? 'var(--color-success)' : 'var(--color-text-secondary)'}}
              />
              <Text weight="semibold" color={state.open ? 'primary' : 'secondary'}>
                {status}
              </Text>
            </HStack>
            {(t.tagline || t.description) && (
              <Text color="secondary" textWrap="pretty" style={{maxWidth: TEXT_MAX_WIDTH}}>
                {t.tagline || t.description}
              </Text>
            )}
          </VStack>
          <HStack gap={2} wrap="wrap">
            <Button label={B.home.route} icon={<Icon icon={NavigationArrow} />} href={mapHref} target="_blank" size="sm" style={pill} />
            {t.instagram && (
              <Button
                label={B.home.instagram}
                icon={<Icon icon={InstagramLogo} />}
                href={`https://www.instagram.com/${t.instagram.replace(/^@/, '')}`}
                target="_blank"
                size="sm"
                style={pill}
              />
            )}
            {hasPhone(t.phone) && <Button label={B.home.call} icon={<Icon icon={Phone} />} href={`tel:${t.phone}`} size="sm" style={pill} />}
          </HStack>
        </VStack>
      </PageContainer>
    </VStack>
  );
}

/** Horizontal strip of masters; hidden automatically for a solo studio (one master). */
export function MastersStrip() {
  const t = useTenant();
  const B = beautyMsg();
  const beauty = useBeauty();
  const masters = mastersOf(t.resources);
  if (masters.length < 2) return null;
  return (
    <RevealSection title={B.home.masters} id="masters-title">
      <Text color="secondary">{B.home.mastersLead}</Text>
      <Carousel aria-label={B.home.masters} gap={3} hasSnap hasEdgeFade={false}>
        {masters.map(m => {
          const selected = beauty.master === m.id;
          const photo = mediaUrl(m.photo_path);
          return (
            <SelectableCard
              key={m.id}
              label={B.home.pickMaster(m.name)}
              isSelected={selected}
              onChange={on => {
                beauty.setMaster(on ? m.id : null);
                if (on) document.getElementById('booking-title')?.scrollIntoView({behavior: 'smooth', block: 'start'});
              }}
              padding={0}
              width={164}
              elevation="low"
            >
              <VStack>
                <VStack style={{aspectRatio: '1 / 1', overflow: 'hidden', borderStartStartRadius: 'inherit', borderStartEndRadius: 'inherit', background: 'var(--color-background-muted)'}}>
                  {photo && <img src={photo} alt="" loading="lazy" width={328} height={328} style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                </VStack>
                <VStack gap={0.5} padding={3}>
                  <HStack gap={1} align="center">
                    <Text weight="bold">{m.name}</Text>
                    {selected && <Icon icon={Check} color="accent" size="sm" />}
                  </HStack>
                  {m.title && (
                    <Text type="supporting" maxLines={2}>
                      {m.title}
                    </Text>
                  )}
                </VStack>
              </VStack>
            </SelectableCard>
          );
        })}
      </Carousel>
    </RevealSection>
  );
}

/**
 * «Запись в студию»: category tabs («Все» + categories) over a dense list of
 * services. Each row: name, duration, description, price and a clear choose
 * button; the chosen service shows «Выбрано».
 */
export function PriceList() {
  const t = useTenant();
  const B = beautyMsg();
  const beauty = useBeauty();
  const categories = useMemo(() => [...new Set(t.services.map(s => s.category))], [t.services]);
  const [tab, setTab] = useState(ALL);
  const current = tab === ALL || categories.includes(tab) ? tab : ALL;
  const chosenMaster = beauty.masters.find(m => m.id === beauty.master);
  const list = t.services.filter(
    s => (current === ALL || s.category === current) && (!chosenMaster || !s.resource_ids || s.resource_ids.includes(chosenMaster.id)),
  );
  return (
    <RevealSection title={B.home.bookingTitle} id="booking-title">
      <Text color="secondary">{B.home.bookingLead}</Text>
      {chosenMaster && (
        <HStack>
          <Button
            label={B.home.clearMaster}
            size="sm"
            variant="secondary"
            onClick={() => beauty.setMaster(null)}
            endContent={<Icon icon={X} />}
            style={{borderRadius: 'var(--radius-full)'}}
          >
            {B.home.masterChosen(chosenMaster.name)}
          </Button>
        </HStack>
      )}
      {categories.length > 1 && (
        <TabList value={current} onChange={setTab} overflow="scroll" size="md" aria-label={msg.home.categories}>
          <Tab value={ALL} label={B.home.all} />
          {categories.map(c => (
            <Tab key={c} value={c} label={c} />
          ))}
        </TabList>
      )}
      {list.length === 0 ? (
        <InlineEmpty title={B.home.noServices} description={B.home.noServicesHint} />
      ) : (
        <Card padding={0} elevation="low">
          <List hasDividers>
            {list.map(s => {
              const chosen = beauty.selection?.serviceId === s.id;
              return (
                <Item
                  as="li"
                  key={s.id}
                  label={s.name}
                  labelLines={3}
                  descriptionLines={4}
                  align="start"
                  density="spacious"
                  isSelected={chosen}
                  description={
                    <VStack gap={0.5}>
                      <Text type="supporting" weight="semibold">
                        {formatDuration(s.duration_minutes)}
                      </Text>
                      {s.description && (
                        <Text type="supporting" maxLines={2}>
                          {s.description}
                        </Text>
                      )}
                    </VStack>
                  }
                  endContent={
                    <VStack gap={1} align="end">
                      <Text weight="bold" hasTabularNumbers textWrap="nowrap">
                        {formatPrice(s.price, s.price_from, t.currency)}
                      </Text>
                      <Button
                        label={B.home.chooseAria(s.name)}
                        size="sm"
                        variant={chosen ? 'primary' : 'secondary'}
                        icon={chosen ? <Icon icon={Check} /> : undefined}
                        onClick={() => beauty.select(s.id)}
                        style={{borderRadius: 'var(--radius-full)', minHeight: 36}}
                      >
                        {chosen ? B.home.chosen : B.home.choose}
                      </Button>
                    </VStack>
                  }
                />
              );
            })}
          </List>
        </Card>
      )}
    </RevealSection>
  );
}

/** Portfolio: an Instagram-like square grid; a photo opens large with its caption. */
export function Portfolio() {
  const t = useTenant();
  const B = beautyMsg();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (!t.gallery.length) return null;
  const media = t.gallery.map(g => ({
    type: 'image' as const,
    src: mediaUrl(g.image_path, g.updated_at) ?? '',
    alt: g.caption || msg.home.workPhoto,
    caption: g.caption || undefined,
  }));
  return (
    <RevealSection title={B.home.portfolio} id="portfolio-title">
      <Grid columns={{minWidth: 104, max: 3}} gap={1} style={{borderRadius: 'var(--radius-container)', overflow: 'hidden'}}>
        {t.gallery.map((g, i) => (
          <ClickableCard
            key={g.id}
            label={g.caption ? msg.home.openPhoto(g.caption) : msg.home.openAnyPhoto}
            padding={0}
            variant="transparent"
            onClick={() => {
              setIndex(i);
              setOpen(true);
            }}
          >
            <img
              src={media[i]!.src}
              alt={media[i]!.alt}
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
              style={{width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block', background: 'var(--color-background-muted)'}}
            />
          </ClickableCard>
        ))}
      </Grid>
      <Lightbox isOpen={open} onOpenChange={setOpen} media={media} index={index} onIndexChange={setIndex} hasZoom />
    </RevealSection>
  );
}
