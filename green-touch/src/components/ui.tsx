/** Small shared pieces of the storefront. Layout through Astryx; colours through tokens. */
import {AspectRatio} from '@astryxdesign/core/AspectRatio';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Minus, Plus, ShoppingBagOpen} from '@phosphor-icons/react';
import type {CSSProperties, ReactNode} from 'react';
import {dispatchCart} from '../lib/cart.ts';
import {formatUah} from '../lib/format.ts';
import {imageUrl} from '../lib/images.ts';
import type {ItemCard as Card_} from '../lib/types.ts';

// The only custom CSS: filling the AspectRatio box with the photo (no Image primitive in Astryx).
const fill: CSSProperties = {width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 'var(--radius-container)'};

/** Product photo or a neutral placeholder that says the photo is coming (never a fake product shot). */
export function ProductImage({path, alt, ratio = 4 / 5, eager = false}: {path: string | null | undefined; alt: string; ratio?: number; eager?: boolean}) {
  const src = imageUrl(path);
  return (
    <AspectRatio ratio={ratio}>
      {src ? (
        <img src={src} alt={alt} style={fill} loading={eager ? 'eager' : 'lazy'} decoding="async" />
      ) : (
        <img src="/placeholder.svg" alt={`${alt}: фото буде додано`} style={fill} loading="lazy" />
      )}
    </AspectRatio>
  );
}

export const itemHref = (i: {kind: string; slug: string}) => (i.kind === 'kit' ? `/nabir/${i.slug}` : `/tovar/${i.slug}`);

/** Price; for kits also the struck-through sum of separate prices labelled «Окремо» and «−15 %». */
export function Price({price, base, discountBp, size = 'md'}: {price: number; base?: number | null; discountBp?: number; size?: 'md' | 'lg'}) {
  const isKit = !!discountBp && !!base && base > price;
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Text type={size === 'lg' ? 'display-3' : 'large'} weight="bold">
        {formatUah(price)}
      </Text>
      {isKit && (
        <>
          <Text type="supporting" color="secondary">
            Окремо{' '}
            <Text type="supporting" color="secondary" hasStrikethrough>
              {formatUah(base!)}
            </Text>
          </Text>
          <Badge variant="success" label={`−${discountBp! / 100}%`} />
        </>
      )}
    </HStack>
  );
}

/** Everything is made to order: shown only when the owner has paused ordering. */
export function Availability({available}: {available: boolean}) {
  return available ? null : <Badge variant="neutral" label="Тимчасово не приймаємо замовлення" />;
}

export function AddToCart({item, qty = 1, size = 'md', width, isIconOnly}: {item: Card_; qty?: number; size?: 'sm' | 'md' | 'lg'; width?: string; isIconOnly?: boolean}) {
  return (
    <Button
      label={item.available ? 'У кошик' : 'Недоступно'}
      isIconOnly={isIconOnly}
      variant="primary"
      size={size}
      width={width}
      isDisabled={!item.available}
      icon={<Icon icon={ShoppingBagOpen} color="inherit" />}
      onClick={() => dispatchCart({type: 'add', item, qty})}
    />
  );
}

const morphStyle = (name: string, cls: string) => ({viewTransitionName: name, viewTransitionClass: cls}) as CSSProperties;

/**
 * Catalog card. Equal-height cards in a row: the title block grows, price and
 * button sit at the bottom, so cards with long names don't shift their neighbours.
 */
export function ItemCard({item, size = 'full', morphKey}: {item: Card_; size?: 'full' | 'compact' | 'tiny'; morphKey?: string}) {
  // morphKey: when the catalog grid is pinched (gridZoom.ts) the photo flies to its
  // new place and size, the caption fades out and back in at the new place
  const morph = morphKey ? morphStyle(`gt-card-${morphKey}`, 'gt-card') : undefined;
  const cardAttr = morphKey ? {'data-card': ''} : {};
  const photo = (
    <figure style={{margin: 0, ...(morphKey ? morphStyle(`gt-photo-${morphKey}`, 'gt-photo') : {})}}>
      <ClickableCard href={itemHref(item)} label={item.name} padding={0} width="100%">
        <ProductImage path={item.image} alt={item.name} />
      </ClickableCard>
    </figure>
  );
  if (size !== 'full') {
    // 3–4 cards per row on a phone: photo, short name and price; the cart button
    // shrinks to a round icon next to the price
    const cartIcon = () =>
      item.available && <Button label="У кошик" variant="primary" size="sm" isIconOnly icon={<Icon icon={ShoppingBagOpen} color="inherit" />} onClick={() => dispatchCart({type: 'add', item, qty: 1})} />;
    return (
      // minWidth 0: long words are cut with «…» instead of pushing into the next card
      <VStack gap={1.5} height="100%" style={{minWidth: 0, ...morph}} {...cardAttr}>
        {photo}
        <StackItem size="fill">
          <Link href={itemHref(item)} label={item.name} color="primary">
            <Text type="supporting" size={size === 'tiny' ? 'xsm' : undefined} weight="semibold" maxLines={2} style={{overflowWrap: 'anywhere'}}>
              {item.name}
            </Text>
          </Link>
        </StackItem>
        <HStack gap={1} vAlign="center" hAlign="between">
          <Text type="supporting" size={size === 'tiny' ? '2xs' : undefined} weight="semibold" style={{whiteSpace: 'nowrap'}}>
            {size === 'tiny' ? formatUah(item.price_kop).replace(/\s*грн$/, ' ₴') : formatUah(item.price_kop)}
          </Text>
          {cartIcon()}
        </HStack>
      </VStack>
    );
  }
  return (
    <VStack gap={3} height="100%" style={morph} {...cardAttr}>
      {photo}
      <StackItem size="fill">
        <VStack gap={1} height="100%">
          <Link href={itemHref(item)} label={item.name} color="primary">
            <Heading level={3} maxLines={3}>
              {item.name}
            </Heading>
          </Link>
          {item.kind === 'kit' && item.short_purpose && (
            <Text type="supporting" color="secondary" maxLines={2}>
              {item.short_purpose}
            </Text>
          )}
          <Text type="supporting" color="secondary">
            {[item.volume, item.kind === 'kit' ? 'Набір догляду' : item.kind === 'sample' ? 'Пробник' : null].filter(Boolean).join(' · ')}
          </Text>
          <StackItem size="fill">{null}</StackItem>
          <Price price={item.price_kop} base={item.base_kop} discountBp={item.discount_bp} />
          <Availability available={item.available} />
        </VStack>
      </StackItem>
      <AddToCart item={item} width="100%" />
    </VStack>
  );
}

export function QtyStepper({value, onChange, max = 50, label}: {value: number; onChange: (n: number) => void; max?: number; label: string}) {
  return (
    <HStack gap={1} vAlign="center">
      <Button label={`Зменшити кількість: ${label}`} variant="ghost" isIconOnly icon={<Icon icon={Minus} size="sm" />} isDisabled={value <= 1} onClick={() => onChange(value - 1)} />
      <Text type="body" weight="semibold" aria-live="polite">
        {value}
      </Text>
      <Button label={`Збільшити кількість: ${label}`} variant="ghost" isIconOnly icon={<Icon icon={Plus} size="sm" />} isDisabled={value >= max} onClick={() => onChange(value + 1)} />
    </HStack>
  );
}

export function PageTitle({title, subtitle, children}: {title: string; subtitle?: ReactNode; children?: ReactNode}) {
  return (
    <VStack gap={2}>
      <Heading level={1}>{title}</Heading>
      {subtitle && (
        <Text type="large" color="secondary">
          {subtitle}
        </Text>
      )}
      {children}
    </VStack>
  );
}
