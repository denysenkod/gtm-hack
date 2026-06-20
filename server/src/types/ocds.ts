export interface OcdsReleasePackage {
  uri?: string;
  version?: string;
  extensions?: string[];
  publisher?: {
    name?: string;
    uri?: string;
  };
  publishedDate?: string;
  releases?: OcdsRelease[];
  links?: {
    next?: string;
    prev?: string;
    self?: string;
  };
}

export interface OcdsRelease {
  ocid?: string;
  id?: string;
  date?: string;
  tag?: string[];
  buyer?: OcdsOrganizationReference;
  parties?: OcdsParty[];
  tender?: OcdsTender;
  planning?: {
    documents?: OcdsDocument[];
  };
  awards?: Array<{
    documents?: OcdsDocument[];
  }>;
  contracts?: Array<{
    documents?: OcdsDocument[];
  }>;
}

export interface OcdsOrganizationReference {
  id?: string;
  name?: string;
}

export interface OcdsParty {
  id?: string;
  name?: string;
  roles?: string[];
}

export interface OcdsTender {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  value?: {
    amount?: number;
    currency?: string;
  };
  minValue?: {
    amount?: number;
    currency?: string;
  };
  procurementMethodDetails?: string;
  submissionMethodDetails?: string;
  tenderPeriod?: {
    startDate?: string;
    endDate?: string;
  };
  enquiryPeriod?: {
    endDate?: string;
  };
  documents?: OcdsDocument[];
  items?: Array<{
    description?: string;
    classification?: {
      id?: string;
      scheme?: string;
      description?: string;
    };
    additionalClassifications?: Array<{
      id?: string;
      scheme?: string;
      description?: string;
    }>;
  }>;
  communication?: {
    atypicalToolUrl?: string;
  };
}

export interface OcdsDocument {
  id?: string;
  documentType?: string;
  title?: string;
  description?: string;
  url?: string;
  uri?: string;
  datePublished?: string;
  dateModified?: string;
  format?: string;
}
