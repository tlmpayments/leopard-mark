/**
 * Registers the PDF renderer with the document pipeline. The shipments and invoices services import this module for
 * its side effect only, so a running app always stores PDF bytes at confirmation and issue (docs/SHIPMENTS_SPEC.md §4).
 */
import "./pdf";
