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

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
}

export const InviteEmail = ({ siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Te invitaron a unirte a {styles.siteName}</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Tienes una invitación</Heading>
          <Text style={styles.text}>
            Te han invitado a formar parte de{" "}
            <Link href={siteUrl} style={styles.link}>
              <strong>{styles.siteName}</strong>
            </Link>
            . Acepta la invitación para crear tu cuenta.
          </Text>
          <Button style={styles.button} href={confirmationUrl}>
            Aceptar invitación
          </Button>
          <Text style={styles.footer}>
            Si no esperabas esta invitación, puedes ignorar este mensaje.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export default InviteEmail;
