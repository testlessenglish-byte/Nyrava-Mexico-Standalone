import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as styles from "./shared-styles";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Confirma tu correo para comenzar a usar {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Confirma tu correo electrónico</Heading>
          <Text style={styles.text}>
            Gracias por registrarte en{" "}
            <Link href={siteUrl} style={styles.link}>
              <strong>{styles.siteName}</strong>
            </Link>
            .
          </Text>
          <Text style={styles.text}>
            Confirma tu dirección ({" "}
            <Link href={`mailto:${recipient}`} style={styles.link}>
              {recipient}
            </Link>{" "}
            ) haciendo clic en el botón:
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Verificar correo
          </Button>
          <Text style={styles.footer}>Si no creaste esta cuenta, puedes ignorar este mensaje.</Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export default SignupEmail;
