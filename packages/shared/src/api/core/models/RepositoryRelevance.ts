/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RepositoryRelevance = {
  score: number;
  normalizedScore: number;
  components: {
    name: {
      hits: number;
      score: number;
      weight: number;
    };
    description: {
      hits: number;
      score: number;
      weight: number;
    };
    tags: {
      hits: number;
      score: number;
      weight: number;
    };
  };
};

