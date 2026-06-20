import type { OcdsReleasePackage } from "../types/ocds.js";
import { addDays } from "../utils/dates.js";

const now = new Date();

export const mockFindTenderResponse: OcdsReleasePackage = {
  uri: "mock://find-a-tender/ocdsReleasePackages",
  version: "1.1",
  publisher: {
    name: "UK Find a Tender Service",
    uri: "https://www.find-tender.service.gov.uk"
  },
  publishedDate: now.toISOString(),
  releases: [
    {
      ocid: "ocds-h6vhtk-050001",
      id: "001",
      date: now.toISOString(),
      tag: ["tender"],
      buyer: {
        id: "GB-PPON-PUBLIC-HEALTH-001",
        name: "Northshire Integrated Care Board"
      },
      parties: [
        {
          id: "GB-PPON-PUBLIC-HEALTH-001",
          name: "Northshire Integrated Care Board",
          roles: ["buyer"]
        }
      ],
      tender: {
        id: "T-001",
        title: "Digital patient engagement and appointment messaging platform",
        description:
          "The authority requires a cloud-hosted patient communication platform covering SMS, email, accessibility-compliant web journeys, CRM integrations, analytics dashboards, support, onboarding, and cyber assurance documentation.",
        status: "active",
        value: {
          amount: 850000,
          currency: "GBP"
        },
        tenderPeriod: {
          startDate: now.toISOString(),
          endDate: addDays(now, 18).toISOString()
        },
        documents: [
          {
            id: "doc-001",
            documentType: "tenderNotice",
            title: "Invitation to Tender",
            url: "https://www.find-tender.service.gov.uk/Notice/001"
          },
          {
            id: "doc-002",
            documentType: "technicalSpecifications",
            title: "Technical requirements pack",
            url: "https://www.find-tender.service.gov.uk/Notice/001/documents"
          }
        ],
        items: [
          {
            description: "Patient engagement software and implementation services",
            classification: {
              scheme: "CPV",
              id: "72260000",
              description: "Software-related services"
            }
          }
        ],
        communication: {
          atypicalToolUrl: "https://www.find-tender.service.gov.uk/Notice/001"
        }
      }
    },
    {
      ocid: "ocds-h6vhtk-050002",
      id: "002",
      date: addDays(now, -2).toISOString(),
      tag: ["tender"],
      buyer: {
        id: "GB-PPON-LOCAL-ENERGY-002",
        name: "Westport City Council"
      },
      parties: [
        {
          id: "GB-PPON-LOCAL-ENERGY-002",
          name: "Westport City Council",
          roles: ["buyer"]
        }
      ],
      tender: {
        id: "T-002",
        title: "Energy retrofit analytics and building management services",
        description:
          "Procurement of specialist consultancy and software for estate energy monitoring, carbon reporting, sensor data collection, facilities management integration, and savings verification across civic buildings.",
        status: "active",
        value: {
          amount: 1250000,
          currency: "GBP"
        },
        tenderPeriod: {
          startDate: addDays(now, -2).toISOString(),
          endDate: addDays(now, 34).toISOString()
        },
        documents: [
          {
            id: "doc-003",
            documentType: "tenderNotice",
            title: "Contract notice",
            url: "https://www.find-tender.service.gov.uk/Notice/002"
          },
          {
            id: "doc-004",
            documentType: "technicalSpecifications",
            title: "Scope and pricing schedule",
            url: "https://www.find-tender.service.gov.uk/Notice/002/documents"
          }
        ],
        items: [
          {
            description: "Energy management software",
            classification: {
              scheme: "CPV",
              id: "71314000",
              description: "Energy and related services"
            }
          }
        ]
      }
    },
    {
      ocid: "ocds-h6vhtk-050003",
      id: "003",
      date: addDays(now, -8).toISOString(),
      tag: ["tender"],
      buyer: {
        id: "GB-PPON-CENTRAL-DATA-003",
        name: "Department for Administrative Services"
      },
      parties: [
        {
          id: "GB-PPON-CENTRAL-DATA-003",
          name: "Department for Administrative Services",
          roles: ["buyer"]
        }
      ],
      tender: {
        id: "T-003",
        title: "Data governance, document automation, and workflow tooling",
        description:
          "A multi-year requirement for secure document processing, data governance workflows, API integration, user training, records management, and service desk support for government casework teams.",
        status: "active",
        value: {
          amount: 2200000,
          currency: "GBP"
        },
        tenderPeriod: {
          startDate: addDays(now, -8).toISOString(),
          endDate: addDays(now, 9).toISOString()
        },
        documents: [
          {
            id: "doc-005",
            documentType: "tenderNotice",
            title: "Procurement documents",
            url: "https://www.find-tender.service.gov.uk/Notice/003"
          }
        ],
        communication: {
          atypicalToolUrl: "https://www.find-tender.service.gov.uk/Notice/003"
        }
      }
    }
  ]
};
