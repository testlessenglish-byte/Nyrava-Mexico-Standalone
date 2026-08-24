import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as styles from "./shared-styles";
import type { TemplateEntry } from "./registry";

interface TeamInviteEmailProps {
  firmName?: string;
  inviterName?: string;
  roleLabel?: string;
  inviteEmail?: string;
  signupUrl?: string;
}

export const TeamInviteEmail = ({
  firmName = "un despacho en Nyrava",
  inviterName,
  roleLabel,
  inviteEmail,
  signupUrl = "https://mexico.nyrava.com/auth",
}: TeamInviteEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Te invitaron a colaborar en {firmName} — Nyrava Intelligence México</Preview>
    <Body style={styles.main}>
      <Section style={styles.wrapper}>
        <Container style={styles.container}>
          <Section style={styles.logoRow}>
            <Img src={styles.logoUrl} alt="Nyrava Intelligence México" style={styles.logoImg} />
          </Section>
          <Heading style={styles.h1}>Te invitaron a unirte a {firmName}</Heading>
          <Text style={styles.text}>
            {inviterName ? `${inviterName} te invitó` : "Te invitaron"} a colaborar en{" "}
            <strong>{firmName}</strong> dentro de Nyrava Intelligence México
            {roleLabel ? ` con el rol de ${roleLabel}` : ""}.
          </Text>
          <Text style={styles.text}>
            Crea tu cuenta con el correo{" "}
            <strong>{inviteEmail ?? "al que llegó esta invitación"}</strong> y tu acceso al equipo se
            activará automáticamente.
          </Text>
          <Button style={styles.button} href={signupUrl}>
            Crear mi cuenta
          </Button>
          <Text style={styles.footer}>
            Si no esperabas esta invitación, puedes ignorar este mensaje.
          </Text>
        </Container>
      </Section>
    </Body>
  </Html>
);

export const template = {
  component: TeamInviteEmail,
  subject: (data: Record<string, any>) =>
    `Invitación para unirte a ${data.firmName ?? "tu equipo"} en Nyrava`,
  displayName: "Invitación de equipo",
  previewData: {
    firmName: "Despacho Ejemplo",
    inviterName: "María López",
    roleLabel: "Abogado",
    inviteEmail: "colega@ejemplo.com",
    signupUrl: "https://mexico.nyrava.com/auth",
  },
} satisfies TemplateEntry;

export default TeamInviteEmail;
