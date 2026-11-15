import {Banner} from '@astryxdesign/core/Banner';
import {Card} from '@astryxdesign/core/Card';
import {VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useQuery} from '@tanstack/react-query';
import {useNavigate} from 'react-router';
import {Page} from '../components/ShopLayout.tsx';
import {ErrorState, Loading, NotFound} from '../components/Status.tsx';
import {getMeta, getPage} from '../lib/api.ts';
import {useMeta} from '../lib/browser.ts';
import {kyivDate} from '../lib/format.ts';

/** Owner-editable information page (Markdown in public.pages). */
export default function InfoPage({slug}: {slug: string}) {
  const page = useQuery({queryKey: ['page', slug], queryFn: () => getPage(slug), staleTime: 5 * 60_000});
  const meta = useQuery({queryKey: ['meta'], queryFn: getMeta, staleTime: 5 * 60_000, enabled: slug === 'kontakty'});
  const navigate = useNavigate();
  useMeta({title: page.data?.title ?? 'Green Touch', description: page.data?.body.replace(/[#*[\]_>-]/g, '').slice(0, 155).trim(), path: `/${slug}`});
  if (page.isPending) return <Loading />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  if (!page.data) return <NotFound />;
  const c = meta.data?.settings.contacts ?? {};
  return (
    <Page width={820}>
      <Heading level={1}>{page.data.title}</Heading>
      {page.data.needs_review && (
        <Banner status="info" title="Текст сторінки ще уточнюється" description="Частину відомостей власниця магазину додасть найближчим часом." collapsible={false} />
      )}
      {slug === 'kontakty' && (c.phone || c.email || c.instagram || c.telegram || c.address) && (
        <Card padding={5}>
          <VStack gap={2}>
            {c.phone && <Link href={`tel:${c.phone}`} label={`Телефон: ${c.phone}`}>{`Телефон: ${c.phone}`}</Link>}
            {c.email && <Link href={`mailto:${c.email}`} label={`Email: ${c.email}`}>{`Email: ${c.email}`}</Link>}
            {c.instagram && <Link href={c.instagram} label="Instagram" isExternalLink>Instagram</Link>}
            {c.telegram && <Link href={c.telegram} label="Telegram" isExternalLink>Telegram</Link>}
            {c.address && <Text type="body">{c.address}</Text>}
            {c.hours && <Text type="body" color="secondary">{c.hours}</Text>}
          </VStack>
        </Card>
      )}
      <Markdown
        headingLevelStart={2}
        onLinkClick={href => {
          if (href.startsWith('/')) {
            navigate(href);
            return false;
          }
        }}
      >
        {page.data.body}
      </Markdown>
      <Text type="supporting" color="secondary">
        Оновлено {kyivDate(page.data.updated_at)}
      </Text>
    </Page>
  );
}
