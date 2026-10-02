"use client";

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Printable ticket PDF — one page per ticket.
 * Labels are English-only: the default PDF fonts (Helvetica) have no Arabic
 * glyphs. Buyer names are rendered as entered; the QR code is the
 * authoritative, locale-independent element at the gate.
 */

export interface TicketPdfItem {
  ticketId: string;
  eventTitle: string;
  eventLocation: string;
  eventDate: string;
  tierName: string;
  buyerName: string;
  buyerPhone: string;
  /** PNG data-URL of the ticket's QR code (captured from the on-screen canvas). */
  qrDataUrl: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#0f172a",
  },
  header: {
    marginBottom: 18,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#4f46e5",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    fontSize: 14,
    fontWeight: 700,
    color: "#4f46e5",
  },
  ticketFor: {
    fontSize: 9,
    color: "#64748b",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  meta: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    marginTop: 18,
    gap: 24,
    alignItems: "flex-start",
  },
  qrBox: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
  },
  qr: {
    width: 150,
    height: 150,
  },
  details: {
    flex: 1,
    gap: 8,
  },
  label: {
    fontSize: 8,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 12,
    fontWeight: 600,
  },
  tier: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#eef2ff",
    color: "#4338ca",
    fontSize: 11,
    fontWeight: 700,
    alignSelf: "flex-start",
    borderRadius: 4,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#94a3b8",
    textAlign: "center",
  },
});

function TicketPage({ item }: { item: TicketPdfItem }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header} fixed>
        <Text style={styles.brand}>Eventra</Text>
        <Text style={styles.ticketFor}>E-Ticket · {item.ticketId.slice(0, 8).toUpperCase()}</Text>
      </View>

      <Text style={styles.title}>{item.eventTitle}</Text>
      <Text style={styles.meta}>{item.eventLocation}</Text>
      <Text style={styles.meta}>{item.eventDate}</Text>

      <View style={styles.row}>
        <View style={styles.qrBox}>
          <Image style={styles.qr} src={item.qrDataUrl} />
        </View>
        <View style={styles.details}>
          <View>
            <Text style={styles.label}>Ticket holder</Text>
            <Text style={styles.value}>{item.buyerName}</Text>
          </View>
          <View>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{item.buyerPhone}</Text>
          </View>
          <View>
            <Text style={styles.label}>Tier</Text>
            <Text style={styles.tier}>{item.tierName}</Text>
          </View>
          <View>
            <Text style={styles.label}>Ticket ID</Text>
            <Text style={styles.value}>{item.ticketId}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.footer} fixed>
        Present this QR code at the entrance. Each code is single-use and verified by the door staff.
      </Text>
    </Page>
  );
}

export function TicketPdf({ items }: { items: TicketPdfItem[] }) {
  return (
    <Document title="Eventra tickets" author="Eventra">
      {items.map((item) => (
        <TicketPage key={item.ticketId} item={item} />
      ))}
    </Document>
  );
}
