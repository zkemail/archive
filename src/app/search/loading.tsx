export default function Loading() {
  return (
    <div className='my-8 flex flex-col items-center justify-center'>
      <div className='relative mx-auto w-14/15 max-w-[720px] overflow-clip rounded-t-3xl'>
        <div className='bg-muted h-40 w-full animate-pulse rounded-3xl md:h-60' />
      </div>
      <div className='flex w-14/15 max-w-[720px] flex-col items-start justify-start gap-6 rounded-br-3xl rounded-bl-3xl border-r border-b border-l border-border bg-foreground p-6'>
        <div className='flex w-full flex-col gap-3'>
          <div className='bg-muted h-6 w-1/3 animate-pulse rounded' />
          <div className='bg-muted h-10 w-full animate-pulse rounded' />
        </div>
        <div className='flex w-full flex-col gap-3'>
          <div className='bg-muted h-6 w-1/2 animate-pulse rounded' />
          <div className='bg-muted h-24 w-full animate-pulse rounded' />
        </div>
      </div>
    </div>
  );
}
