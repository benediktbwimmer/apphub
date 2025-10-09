CREATE SEQUENCE IF NOT EXISTS apphub_event_ingress_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 128;

COMMENT ON SEQUENCE apphub_event_ingress_seq IS 'AppHub ingress sequence generator for global event ordering';
