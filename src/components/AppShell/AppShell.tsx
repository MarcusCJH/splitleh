import type { ReactNode } from 'react'
import BottomNav from '../BottomNav/BottomNav'
import styles from './AppShell.module.css'

interface Props {
  children: ReactNode
}

export default function AppShell({ children }: Props) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
