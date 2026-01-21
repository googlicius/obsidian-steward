import { ContentReadingResult } from 'src/services/ContentReadingService';
import { ArtifactType, ReadContentArtifact } from './types';

/**
 * Read content artifact implementation
 */
export class ReadContentArtifactImpl implements ReadContentArtifact {
  artifactType: ArtifactType.READ_CONTENT;
  readingResults: ContentReadingResult[];
  imagePaths?: string[];
  createdAt?: number;
  id?: string;
  deleteReason?: string;

  constructor(data: ReadContentArtifact) {
    this.artifactType = ArtifactType.READ_CONTENT;
    this.readingResults = data.readingResults;
    this.imagePaths = data.imagePaths;
    this.createdAt = data.createdAt;
    this.id = data.id;
    this.deleteReason = data.deleteReason;
  }
}
