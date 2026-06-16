import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  signerName: string
  documentTitle: string
  magicUrl: string
  ownerEmail: string
  expiresIn: number
}

export function MagicLinkEmail({
  signerName,
  documentTitle,
  magicUrl,
  ownerEmail,
  expiresIn,
}: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You&apos;ve been asked to sign: {documentTitle}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>SignProz</Heading>
          <Text style={styles.greeting}>Hi {signerName},</Text>
          <Text style={styles.text}>
            You&apos;ve been asked to sign the document: <strong>{documentTitle}</strong>.
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={magicUrl} style={styles.button}>
              Review and Sign Document
            </Button>
          </Section>
          <Text style={styles.text}>
            Or copy and paste this URL into your browser:
          </Text>
          <Link href={magicUrl} style={styles.link}>{magicUrl}</Link>
          <Text style={styles.footer}>
            This link expires in {expiresIn} days. If you did not expect this email,
            you can safely ignore it.
          </Text>
          <Text style={styles.sender}>
            Sent via SignProz on behalf of {ownerEmail}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const styles = {
  body: { backgroundColor: '#f8fafc', fontFamily: 'sans-serif' },
  container: { maxWidth: '560px', margin: '0 auto', padding: '32px 16px' },
  heading: { fontSize: '24px', color: '#1e40af', marginBottom: '24px' },
  greeting: { fontSize: '16px', color: '#374151' },
  text: { fontSize: '16px', color: '#374151', lineHeight: '1.5' },
  buttonSection: { textAlign: 'center' as const, margin: '24px 0' },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '16px',
    padding: '12px 24px',
    textDecoration: 'none',
  },
  link: { fontSize: '14px', color: '#2563eb', wordBreak: 'break-all' as const },
  footer: { fontSize: '14px', color: '#9ca3af', marginTop: '32px' },
  sender: { fontSize: '12px', color: '#9ca3af', marginTop: '4px' },
}
