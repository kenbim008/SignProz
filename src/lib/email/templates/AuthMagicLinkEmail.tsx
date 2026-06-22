import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from '@react-email/components'

interface AuthMagicLinkEmailProps {
  email: string
  magicUrl: string
  type: 'login' | 'signup'
}

export function AuthMagicLinkEmail({ magicUrl, type }: AuthMagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your SignProz {type} link</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>SignProz</Heading>
          <Text style={styles.greeting}>Hi,</Text>
          <Text style={styles.text}>
            Click the button below to {type === 'login' ? 'sign in to' : 'complete your signup for'} SignProz:
          </Text>
          <Section style={styles.buttonSection}>
            <Button href={magicUrl} style={styles.button}>
              {type === 'login' ? 'Sign In to SignProz' : 'Complete Signup'}
            </Button>
          </Section>
          <Text style={styles.text}>
            Or copy and paste this URL into your browser:
          </Text>
          <Link href={magicUrl} style={styles.link}>{magicUrl}</Link>
          <Text style={styles.footer}>
            This link expires in 1 hour. If you did not request this, you can safely ignore it.
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
}
