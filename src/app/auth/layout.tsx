import { AuthFrame } from "@/components/layout/auth-frame";

export default function AuthFlowLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
