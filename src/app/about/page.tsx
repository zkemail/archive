import { getArchiveStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const stats = await getArchiveStats();

  return (
    <main className='mx-auto max-w-3xl px-6 py-16'>
      <h1 className='mb-8 text-3xl font-bold'>About</h1>

      <section className='mb-10'>
        <p className='mb-4 text-secondary'>
          The DKIM Archive is a public, searchable database of DKIM (DomainKeys
          Identified Mail) signing keys collected from email providers
          worldwide. It enables users to search for domains and retrieve
          archived DKIM selectors and keys.
        </p>
        <p className='text-secondary'>
          The archive is part of the{' '}
          <a
            href='https://zk.email'
            className='text-primary underline hover:opacity-80'
            target='_blank'
            rel='noreferrer noopener'
          >
            ZK Email
          </a>{' '}
          initiative, which uses zero-knowledge proofs to verify email
          signatures without revealing the email contents.
        </p>
      </section>

      <section className='mb-10'>
        <h2 className='mb-4 text-xl font-semibold'>How it works</h2>
        <p className='mb-4 text-secondary'>
          When an email is sent, the sender&apos;s mail server signs it with a
          DKIM key. The corresponding public key is published in DNS records.
          The archive collects and stores these public keys so they remain
          available even after the domain rotates or removes them.
        </p>
        <p className='text-secondary'>
          Users can contribute new domain and selector pairs through the{' '}
          <a
            href='/contribute'
            className='text-primary underline hover:opacity-80'
          >
            Contribute
          </a>{' '}
          page. When entries are submitted, the archive retrieves the
          corresponding DKIM key via DNS lookup and stores it in the database.
        </p>
      </section>

      <section>
        <h2 className='mb-4 text-xl font-semibold'>Archive statistics</h2>
        <div className='grid grid-cols-2 gap-4'>
          <div className='rounded-lg border border-border bg-foreground p-4'>
            <p className='text-2xl font-bold'>
              {stats.uniqueDomains.toLocaleString()}
            </p>
            <p className='text-sm text-ring'>Unique domains</p>
          </div>
          <div className='rounded-lg border border-border bg-foreground p-4'>
            <p className='text-2xl font-bold'>
              {stats.uniqueSelectors.toLocaleString()}
            </p>
            <p className='text-sm text-ring'>Unique selectors</p>
          </div>
          <div className='rounded-lg border border-border bg-foreground p-4'>
            <p className='text-2xl font-bold'>
              {stats.domainSelectorPairs.toLocaleString()}
            </p>
            <p className='text-sm text-ring'>Domain/selector pairs</p>
          </div>
          <div className='rounded-lg border border-border bg-foreground p-4'>
            <p className='text-2xl font-bold'>
              {stats.dkimKeys.toLocaleString()}
            </p>
            <p className='text-sm text-ring'>DKIM keys</p>
          </div>
        </div>
      </section>
    </main>
  );
}
