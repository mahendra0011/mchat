import { redirect } from 'next/navigation';

export default function HomePage() {
  // The authenticated shell lives under /chat; the root simply forwards there.
  redirect('/chat');
}
