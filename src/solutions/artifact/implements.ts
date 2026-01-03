import { ContentReadingResult } from 'src/services/ContentReadingService';
import { ArtifactType, ReadContentArtifact } from './types';

/**
 * Read content artifact implementation
 */
export class ReadContentArtifactImpl implements ReadContentArtifact {
  artifactType: ArtifactType.READ_CONTENT;
  readingResult: ContentReadingResult;
  imagePaths?: string[];
  createdAt?: number;
  id?: string;
  deleteReason?: string;

  constructor(data: ReadContentArtifact) {
    this.artifactType = ArtifactType.READ_CONTENT;
    this.readingResult = data.readingResult;
    this.imagePaths = data.imagePaths;
    this.createdAt = data.createdAt;
    this.id = data.id;
    this.deleteReason = data.deleteReason;
  }
}
