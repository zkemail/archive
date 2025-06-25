'use client';
import {
  DiamondIcon,
  GithubLogoIcon,
  Icon,
  TelegramLogoIcon,
  XLogoIcon,
  YoutubeLogoIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';

interface HoverSwapIconProps {
  href: string;
  ariaLabel: string;
  Icon: Icon;
}

export const HoverSwapIcon = ({
  href,
  ariaLabel,
  Icon,
}: HoverSwapIconProps) => (
  <Link
    href={href}
    aria-label={ariaLabel}
    target='_blank'
    className='group text-secondary dark:text-ring relative inline-block size-5'
  >
    {/* Outline (Regular) Icon */}
    <Icon
      className='absolute inset-0 h-full w-full transition-opacity duration-300 group-hover:opacity-0'
      weight='regular'
    />

    {/* Solid (Fill) Icon */}
    <Icon
      className='absolute inset-0 h-full w-full opacity-0 transition-opacity duration-300 group-hover:opacity-100'
      weight='fill'
    />
  </Link>
);

function FooterLinks() {
  return (
    <div className='text-ring flex flex-row items-center justify-between gap-4 text-base leading-tight'>
      <Link href='/about' className='hidden sm:flex'>
        About
      </Link>
      <DiamondIcon
        className='hidden sm:flex'
        color='#606060'
        size={8}
        weight='fill'
      />
      <Link href='/api' className='hover:text-secondary hidden sm:flex'>
        Explore API
      </Link>
      <DiamondIcon
        className='hover:text-secondary hidden sm:flex'
        color='#606060'
        size={8}
        weight='fill'
      />
      <Link
        href='https://zk.email/privacy-policy'
        className='hover:text-secondary'
      >
        Privacy Policy
      </Link>
    </div>
  );
}

function SocialLinks() {
  return (
    <div className='flex flex-row justify-around gap-3'>
      <HoverSwapIcon
        href='https://www.youtube.com/@zkemail'
        ariaLabel='Visit us on Youtube'
        Icon={YoutubeLogoIcon}
      />
      <HoverSwapIcon
        href='https://x.com/zkemail'
        ariaLabel='Visit us on X'
        Icon={XLogoIcon}
      />
      <HoverSwapIcon
        href='https://t.me/zkemail'
        ariaLabel='Visit us on Telegram'
        Icon={TelegramLogoIcon}
      />
      <HoverSwapIcon
        href='https://github.com/zkemail'
        ariaLabel='Visit us on Github'
        Icon={GithubLogoIcon}
      />
    </div>
  );
}

export default function Footer() {
  return (
    <footer className='bg-foreground border-border flex w-full items-center justify-between border-t px-4 py-5 sm:justify-evenly'>
      <FooterLinks />
      <SocialLinks />
    </footer>
  );
}
